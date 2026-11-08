# 0036. Make Published Knowledge Base Articles Reliably Searchable By The AI

**Date**: 2026-11-08
**Status**: Accepted

## Summary

Today a published Knowledge Base article is not really searchable by the AI. The embedding model the code calls (`text-embedding-004`) was retired by Google and returns 404, so every article and every customer question is turned into a crude word hash instead of a real meaning vector (an embedding, a list of numbers that captures meaning). The chat model also hangs. This spec moves indexing to `gemini-embedding-001`, makes "published" mean "proven searchable", swaps edits in without downtime, and verifies who is allowed to change the Knowledge Base.

## Context

The AI support page (`customer-ticketing/ai-support`) answers customers by searching published Knowledge Base articles (RAG, retrieval augmented generation: find the most relevant article chunks, then let the model answer from them). `RagService::generateEmbedding()` calls `models/text-embedding-004`, which now returns HTTP 404. A non 2xx response does not throw, so the code silently falls through to `computeFallbackEmbedding()`, a crc32 word hash, and logs nothing. All 6 published articles (11 active embeddings) and every customer query are in that hash space, so a match only happens on literal word overlap. A paraphrased question ("my printer keeps eating paper") misses an article titled "Paper Jam".

The publish path has its own gaps. `KbArticleController::publish()` flips status and then fires `ArticlePublished`, whose listener dispatches `IndexKbArticleJob`. With `QUEUE_CONNECTION=sync` that job runs inline and indexes the article again, which deletes and recreates every chunk (the regenerated chunk IDs seen in `KbArticlePublishArchiveTest`). An article with no embeddings can be published into a `Processing` state that may never complete. Editing a published article deletes its old chunks before the new ones exist, so for the length of the edit the AI cannot see it. The retrieval threshold (`minScore = 0.20`) was tuned for the hash vectors and is far too permissive for real embeddings.

The configured chat model, `gemini-3.8-flash`, timed out at 45 seconds in a direct test, while `gemini-3.5-flash` answered in 1.7 seconds on the same key. That is why customers see "Our automated AI support assistant is temporarily unavailable", and why the ts050 test receives that text instead of the "no published article" reply.

Finally, every KB write action decides "is superadmin" in `resolveActor()` by base64 decoding the JWT payload without checking its signature, so any caller can forge `role: superadmin` and publish or delete articles. Spec 0034 already established verified identity (Passport `auth('api')` or a valid internal token) for the chat routes, and the KB routes sit outside that middleware group.

Constraints from `AGENTS.md`: AI fallback must degrade to manual ticket creation (`escalate: true`), never to a local model such as Ollama. Thin controllers, so logic goes in `app/Services/`. Schema changes go through timestamped migrations. No direct coupling to other services' tables.

## Requirements

**User stories**:
- As a superadmin, I want a published article to be usable by the AI the moment publish succeeds, so customers get the right answer immediately.
- As a superadmin, I want to see when indexing failed or an article is hard to find, so I can fix it instead of assuming it works.
- As a customer, I want the AI to find the right article even when I describe the problem in my own words.

**Acceptance criteria**:
- **AC-1**: Indexing embeds every chunk with the configured model (`gemini-embedding-001`, 768 dimensions), and every `kb_embeddings` row stores `embedding_model`. No hash fallback vector is ever written to `kb_embeddings`.
- **AC-2**: If the embedding API fails during indexing (non 2xx, timeout, or empty values), the article's `processing_status` becomes `Indexing failed`, `index_error` holds a readable reason (never the API key), no partial new chunks are left behind, and a warning is logged.
- **AC-3**: Publish returns 422 with `error_code: NOT_INDEXED` unless the article has at least one embedding from the current model and `processing_status` is `Ready for AI Search`. Publishing an article whose `content_hash` is unchanged only activates its existing embeddings. Chunk and embedding IDs stay identical.
- **AC-4**: When publish returns 200, `RagService::retrieve()` can return the article on the very next call. No queue job is needed for it to become searchable.
- **AC-5**: After a successful publish, a self retrieval probe runs with the article's title plus description as the query. Its score is stored in `probe_score`. If the article is not in the top 3 results, or its score is below `KB_MIN_SCORE`, the response carries `low_retrievability: true` and the KB page shows "Published, low retrievability" with the score. The article stays Published.
- **AC-6**: Editing the content of a Published article builds the new chunks and embeddings as inactive. Only when all of them succeed does one database transaction delete the old set and activate the new one. If indexing fails, the old set keeps serving customers, and the article shows `Indexing failed` with the reason.
- **AC-7**: An edit that does not change the indexed text (same `content_hash`) does not call the embedding API. Metadata in `kb_chunks.metadata` (title, category, machine, version) is updated in place.
- **AC-8**: Retrieval considers only embeddings where `is_active = true`, `embedding_model` equals the configured model, and the article is Published. If embedding the customer's query fails, the AI replies with the manual ticket path (`escalate: true`) and does not compare against hash vectors.
- **AC-9**: The match threshold comes from `KB_MIN_SCORE` (default `0.55`). `php artisan kb:reembed` embeds every article again with the current model, can safely run more than once, keeps each article live until its new set is swapped in, and prints a per article result plus min, median and max probe scores for calibration.
- **AC-10**: The chat uses `GEMINI_MODEL=gemini-3.5-flash` with a request timeout of at most 15 seconds. On timeout or error the AI escalates to manual ticket creation (`escalate: true`).
- **AC-11**: Every KB write endpoint (store, update, publish, archive, reindex, replace file, import CSV, scan file, destroy) resolves the actor only from a verified Passport token (`auth('api')`) or a valid internal token. A hand made, unsigned JWT claiming `role: superadmin` gets 401 (no verified user) or 403 (verified but not superadmin).
- **AC-12**: The three currently failing AI service tests pass, updated where their expectations encoded the old behavior: `KbArticlePublishArchiveTest` (publish without embeddings → `NOT_INDEXED`, publish keeps chunk IDs) and `RagTroubleshootingAndAutoIndexingTest::ts050` (no match → "could not find any published articles" reply).

## Options considered

### Option 1: Fix in place on the existing tables (chosen)

Keep `kb_articles`, `kb_chunks`, `kb_embeddings` and the PHP cosine search. Switch the embedding model, add three tracking columns and a probe score, make indexing fail loudly, separate "index" from "publish", and swap edits atomically.

**Pros**:
- No new infrastructure. The 768 dimension output of `gemini-embedding-001` fits the existing rows.
- Small, reviewable change concentrated in `RagService`, the KB controller and one job.

**Cons**:
- Cosine similarity in PHP over every active vector scales linearly. Fine for hundreds of articles, slow for tens of thousands.

### Option 2: Move vectors to a dedicated vector store

Store embeddings in a vector database or a MySQL vector index and query it for nearest neighbors.

**Pros**:
- Scales to large corpora with fast approximate search.

**Cons**:
- A new component to run, back up and secure, for a corpus of a few hundred articles. That is premature optimisation.
- Does not by itself fix the root causes (the dead model, silent fallback, publish semantics).

### Option 3: Keep the hash embeddings and switch to keyword search

Drop the remote embedding call and rely on word overlap or MySQL full text search.

**Pros**:
- No external dependency or API cost.

**Cons**:
- Misses paraphrased questions, which is the main way customers describe problems.

## Decision

**Chosen option**: Option 1: Fix in place on the existing tables.

Index with `gemini-embedding-001` at 768 dimensions and refuse to store fallback vectors. Publishing means "already indexed with the current model, then activated and probed". Live edits swap in atomically. KB writes trust only verified identity.

**Implementation skills**: `gemini-ai` (`.claude/skills/gemini-ai/`) · `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`)

Decisions made while writing (each with its runner up):
- **Batch embedding calls**: use `batchEmbedContents` (up to 100 chunks per request) so a large document indexes in a few calls instead of one call per chunk. Runner up: one call per chunk, which is simpler but makes big uploads slow inside a synchronous request.
- **Probe "top N"**: 3. With few articles in a category, top 1 is too strict when two articles cover similar ground. Runner up: top 1.
- **Query embedding failure**: escalate through the manual ticket path rather than searching hash vectors. Runner up: a keyword match fallback, rejected because it brings back the mixed space problem.
- **Concurrency**: take `Cache::lock("kb:index:{id}", 120)` around indexing. A second concurrent index attempt for the same article returns 409. Runner up: a database row lock, heavier for an operation that calls an external API.
- **Indexing stays synchronous**, inside the upload, edit or replace request (the engineer chose "ready when publish returns"). The `ArticlePublished` and `ArticleUpdated` listeners stop indexing again. They only refresh caches and broadcast.

## Rationale

The failure is not architectural, it is a dead dependency hidden by a silent fallback, plus a publish step that does indexing work it should not. Fixing those in place restores real semantic search on the existing schema, because `gemini-embedding-001` can output 768 dimensions. A vector store (Option 2) would add an operational component without addressing why search is broken, and at this corpus size a linear scan is fast. Keyword search (Option 3) would make the AI worse at the job it exists for.

Refusing to store fallback vectors (AC-1, AC-8) is the load bearing rule. Vectors from two different models are not comparable, so any mix makes scores meaningless. Recording `embedding_model` on every row makes that rule enforceable in the query, and it makes the next model change a routine `kb:reembed` instead of an investigation.

Moving indexing to upload and edit time, and making publish a cheap activation plus probe, is what lets "published" mean "searchable now" (AC-3, AC-4) without depending on a queue that is configured as `sync`. The probe turns "is it ready?" from a belief into a measured score the superadmin can act on (AC-5).

## Feature design

**Data model sketch** (one timestamped migration, all new columns nullable for a safe rollout):

| Table | Column | Type | Notes |
|---|---|---|---|
| `kb_embeddings` | `embedding_model` | `string(64)`, nullable, indexed | Set on every new row. Backfilled to `hash-fallback-v1` for existing rows. Retrieval filters on it. |
| `kb_articles` | `content_hash` | `char(64)`, nullable | SHA256 of the exact text that was chunked (content, else description, else title). |
| `kb_articles` | `index_error` | `text`, nullable | Last indexing failure reason. Cleared on success. |
| `kb_articles` | `probe_score` | `decimal(5,4)`, nullable | Self retrieval score from the last publish or `kb:reembed`. |

Relationships are unchanged: `kb_articles` 1:N `kb_chunks`, `kb_chunks` 1:1 `kb_embeddings` (`kb_embeddings.article_id` stays denormalised for filtering).

**State transitions** (`processing_status`, separate from the publish `status`):
- `Draft` (no content yet) → `Indexing` (upload, edit with a changed hash, replace file, reindex, `kb:reembed`)
- `Indexing` → `Ready for AI Search` (all chunks embedded, new set swapped in)
- `Indexing` → `Indexing failed` (any embedding failure; the previous set, if any, stays active)
- `Indexing failed` → `Indexing` (Retry button, which is `POST /articles/{id}/reindex`)

Publish `status`: `Draft` → `Published` only from `Ready for AI Search`. `Published` → `Archived` deactivates embeddings. `Archived` → `Published` reactivates them if they are from the current model, otherwise publish returns `NOT_INDEXED`.

**API surface** (AI service, routes under `/api/articles` and the `/api/kb` alias):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/articles` | POST | title (req), content, description, tags | article, `processing_status` | verified superadmin | 401, 403, 422, 502 when embedding fails (article saved with `Indexing failed`) |
| `/articles/{id}` | PATCH | any metadata or content field | article; re-embedded only if the hash changed | verified superadmin | 401, 403, 404, 409 (index lock held) |
| `/articles/{id}/publish` | POST | none | article plus `probe: {score, rank, low_retrievability}` | verified superadmin | 401, 403, 404, 422 `NOT_INDEXED` |
| `/articles/{id}/reindex` | POST | none | article with new `processing_status` | verified superadmin | 401, 403, 404, 409 |
| `/articles/{id}/replace-file` | POST | file | article (indexed, swapped if Published) | verified superadmin | 401, 403, 422, 409 |
| `/articles/import-csv` | POST | file | imported articles, each with its own `processing_status` | verified superadmin | 401, 403, 422 |
| `/articles/{id}/archive`, `/articles/{id}` DELETE, `/articles/scan-file` | as today | as today | as today | verified superadmin | 401, 403 |

`formatArticle()` gains `index_error`, `probe_score` and `low_retrievability` (derived: `probe_score` is null, or below `KB_MIN_SCORE`, or rank is above 3 at the last probe; store the rank alongside the score in `history` for display).

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Index | embedding vector | `gemini-embedding-001` `batchEmbedContents` with `outputDimensionality = KB_EMBEDDING_DIMS` |
| Index | `embedding_model` | config `KB_EMBEDDING_MODEL` |
| Index | `content_hash` | SHA256 of the text passed to `chunkText()` |
| Index | `index_error` | failure category plus HTTP status or exception class; the request URL is never included (it carries the key) |
| Publish | `probe_score`, rank | `retrieve(title + "\n" + description, 3, 0.0)`, the score and position of this article's best chunk |
| Publish | `low_retrievability` | derived: rank > 3, or score < `KB_MIN_SCORE` |
| Retrieve | candidate set | `kb_embeddings` where `is_active`, `embedding_model = KB_EMBEDDING_MODEL`, article `status = Published` |
| Retrieve | match threshold | config `KB_MIN_SCORE` |
| Any KB write | actor name and role | verified user from `auth('api')`, or `Internal Service` for a valid internal token |
| Chat | model and timeout | `GEMINI_MODEL`, `GEMINI_TIMEOUT_SECONDS` (default 15) |
| `kb:reembed` | score stats | min, median, max of the per article probe scores |

**Key invariants**:
- No row in `kb_embeddings` with `is_active = true` has an `embedding_model` other than the configured one after `kb:reembed` completes.
- An article with `status = Published` always has at least one active embedding, except during the single swap transaction.
- `computeFallbackEmbedding()` is never used for storage or retrieval. Remove it, or keep it only behind the `testing` environment for offline tests.
- Indexing for one article never runs twice at the same time (cache lock).
- The Gemini API key never appears in logs, `index_error`, or exception messages surfaced to clients. Send it as the `x-goog-api-key` header instead of a `?key=` query string.

**Security model**:
- KB writes: superadmin only, identity from a verified Passport token or a valid internal token (spec 0034 pattern, `AuthenticateTokenOrInternal`). Remove the payload decode branch of `resolveActor()`.
- KB reads (`GET /articles`, `/articles/{id}`, file download): unchanged in this spec (see Follow-up).
- Customers reach KB content only through the AI's answers and source list.

**Configuration required**:
- `KB_EMBEDDING_MODEL`: embedding model id, default `gemini-embedding-001`.
- `KB_EMBEDDING_DIMS`: output dimensions, default `768`.
- `KB_MIN_SCORE`: retrieval and probe threshold, default `0.55` (calibrate with `kb:reembed` output).
- `GEMINI_MODEL`: change to `gemini-3.5-flash`.
- `GEMINI_TIMEOUT_SECONDS`: chat request timeout, default `15`.

**Critical test scenarios**:
- Happy path: create an article, it indexes with the faked Gemini batch endpoint (each row has `embedding_model`), publish returns 200 with a probe, and `retrieve()` with a paraphrased query returns it. Verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**.
- Failure: the Gemini endpoint returns 404 during indexing, so the status is `Indexing failed`, `index_error` is set, no chunks remain, and publish returns `NOT_INDEXED`. Verifies **AC-2**, **AC-3**.
- Live edit failure: a published article is edited, the embedding call fails, the old embeddings are still active and still retrievable. Verifies **AC-6**.
- Metadata only edit: Http fake records zero embedding calls, and chunk IDs are unchanged. Verifies **AC-7**.
- Mixed models: a seeded `hash-fallback-v1` active row is never returned by `retrieve()`. Verifies **AC-8**.
- Query embedding failure: chat returns `escalate: true` and the manual ticket text. Verifies **AC-8**, **AC-10**.
- Auth: an unsigned JWT with `role: superadmin` calling publish gets 401, and a verified employee gets 403. Verifies **AC-11**.
- `kb:reembed` run twice: the second run swaps cleanly, stays idempotent, and prints stats. Verifies **AC-9**.

## Build plan

Build approach: none recorded in `AGENTS.md`, so this assumes Tracer Bullet slices (a thin end to end thread first, then thicken).

1. Migration for the four columns, backfilling `kb_embeddings.embedding_model = 'hash-fallback-v1'`. Satisfies **AC-1**, **AC-5**, **AC-6**.
2. Config keys (`config/services.php`, `.env.example`) and a new `EmbeddingClient` service in `app/Services/` calling `batchEmbedContents` with a header key, typed exceptions for failure, and no fallback. Satisfies **AC-1**, **AC-2**.
3. Thread: rewrite `RagService::indexArticle()` to hash, compare, embed into an inactive set, then swap in one transaction under the cache lock, setting `processing_status`, `content_hash` and `index_error`. Satisfies **AC-1**, **AC-2**, **AC-6**, **AC-7**.
4. Thread: filter `retrieve()` by `embedding_model`, read `KB_MIN_SCORE`, and escalate on query embedding failure. Satisfies **AC-8**.
5. Thread: make `publish()` require the current model's embeddings, activate without indexing again, run the probe and store `probe_score`. Stop the `ArticlePublished` and `ArticleUpdated` listeners from indexing. Satisfies **AC-3**, **AC-4**, **AC-5**.
6. Route `store`, `update`, `replaceFile`, `importCsv` and `reindex` through the new `indexArticle()`, returning the 502 and 409 cases. Satisfies **AC-2**, **AC-6**, **AC-7**.
7. Replace `resolveActor()` with verified identity, and move the KB write routes under the `auth.token_or_internal` middleware. Satisfies **AC-11**.
8. `kb:reembed` artisan command with per article results and score stats. Satisfies **AC-9**.
9. Chat model and timeout config in `GeminiService`, with the escalate path on timeout. Satisfies **AC-10**.
10. KB page (`AIKnowledgeBase.jsx`): show `Indexing`, `Indexing failed` with `index_error` and a Retry button, and "Published, low retrievability" with the score. Handle `NOT_INDEXED`. Satisfies **AC-2**, **AC-3**, **AC-5**.
11. Update and add the tests listed above, and fix the three failing ones. Satisfies **AC-12** and every AC above.

## Migration plan

**Strategy**: strangler, in one deploy window.
**Phases**:
1. Run the migration (nullable columns plus backfill). Deploy the code. From this moment retrieval ignores `hash-fallback-v1` rows, so the AI escalates to manual tickets until phase 2 finishes.
2. Immediately run `php artisan kb:reembed`. Each article swaps to real embeddings as it completes. Review the printed score stats and set `KB_MIN_SCORE`.
3. Fix any article reported as failed with Retry, or by editing it.
**Rollback**: revert the code. The old code embeds queries with the dead model, so its hash vectors would no longer match the new rows. After a revert, run the old reindex for each article. The columns are nullable and can stay.
**Risks**: a Gemini outage during phase 2 leaves articles unsearchable (the AI escalates to manual tickets, which is the approved fallback). The API rate limit can throttle a large `kb:reembed`, so the command should pause and retry on 429.

## Consequences

**Positive**:
- Customers get matches on meaning, not word overlap.
- "Published" becomes a verified state with a visible score. Failures are visible instead of silent.
- Edits to live articles cause no AI downtime.
- Only verified superadmins can change what the AI tells customers.

**Negative / tradeoffs**:
- Hard dependency on the Gemini embedding API for indexing. No offline indexing, by design.
- Uploads and edits get slower, since they wait for embedding. Batching keeps this to seconds for normal documents.
- A short window after deploy where the AI escalates everything, until `kb:reembed` finishes.
- The linear cosine scan remains, which is fine at this size and must be revisited past a few thousand articles.

**Neutral**:
- A model change in future is now config plus `kb:reembed`.
- The `IndexKbArticleJob` listeners for publish and update become cache and broadcast only. The delete purge job stays.

## Follow-up

- [ ] Restrict `GET /articles` and `/articles/{id}` to staff. They are unauthenticated today and expose drafts (engineer chose to leave this out of this spec).
- [ ] Remove the `frontend-dev-token` superadmin bypass and the "local environment with no Authorization header means superadmin" shortcut in `resolveActor()` (left out of this spec by choice; both are unverified identity).
- [ ] The `ticket_audit_logs` write in `AuditLoggingService` reads the `employees` table directly from the AI service, which conflicts with the no direct database coupling invariant. Route it through the employee service or an event.
- [ ] Gemini API key: rotate it, since it was printed in a local debugging session, and move every Gemini call to the `x-goog-api-key` header.
- [ ] Revisit the vector search approach if the KB grows past a few thousand articles.
