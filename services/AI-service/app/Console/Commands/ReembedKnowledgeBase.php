<?php

namespace App\Console\Commands;

use App\Exceptions\EmbeddingFailedException;
use App\Exceptions\IndexingInProgressException;
use App\Models\KbArticle;
use App\Services\EmbeddingClient;
use App\Services\RagService;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Spec 0036 (AC-9): embed every Knowledge Base article again with the configured model.
 *
 * Safe to run more than once. Each article keeps serving its current set until its new set is
 * swapped in by RagService::indexArticle(). Published articles are probed afterwards, and the
 * min, median and max probe scores are printed so KB_MIN_SCORE can be calibrated.
 */
class ReembedKnowledgeBase extends Command
{
    protected $signature = 'kb:reembed
                            {--article=* : Only these article IDs}
                            {--retries=3 : How many times to wait and retry when the API rate limits (HTTP 429)}';

    protected $description = 'Embed every Knowledge Base article again with the configured embedding model and report probe scores.';

    public function handle(RagService $ragService, EmbeddingClient $client): int
    {
        $rag = $ragService->withEmbeddingClient($client->withRateLimitRetries((int) $this->option('retries')));

        $query = KbArticle::query()->orderBy('id');
        $only = array_filter(array_map('intval', (array) $this->option('article')));
        if (!empty($only)) {
            $query->whereIn('id', $only);
        }

        $this->info("Re-embedding with {$rag->embeddingModel()} (KB_MIN_SCORE = {$rag->minScore()}).");

        $rows = [];
        $scores = [];
        $failed = 0;

        $query->chunkById(50, function ($articles) use ($rag, &$rows, &$scores, &$failed) {
            foreach ($articles as $article) {
                $row = ['id' => $article->id, 'title' => Str::limit((string) $article->title, 48), 'status' => $article->status, 'result' => '', 'score' => '', 'rank' => ''];

                try {
                    $rag->indexArticle($article, null, true);
                    $row['result'] = 'ok';
                } catch (IndexingInProgressException $e) {
                    $row['result'] = 'skipped (being indexed)';
                    $rows[] = $row;
                    continue;
                } catch (EmbeddingFailedException $e) {
                    $failed++;
                    $row['result'] = 'failed: ' . $e->getMessage();
                    $rows[] = $row;
                    continue;
                }

                if ($article->fresh()->status === 'Published') {
                    $probe = $rag->probeArticle($article);
                    $this->recordProbe($article, $probe);
                    $row['score'] = $probe['score'] === null ? 'n/a' : number_format($probe['score'], 4);
                    $row['rank'] = $probe['rank'] ?? 'n/a';
                    if ($probe['low_retrievability']) {
                        $row['result'] = 'ok, low retrievability';
                    }
                    if ($probe['score'] !== null) {
                        $scores[] = $probe['score'];
                    }
                }

                $rows[] = $row;
            }
        });

        $this->table(['ID', 'Title', 'Status', 'Result', 'Probe score', 'Rank'], $rows);

        if (!empty($scores)) {
            sort($scores);
            $count = count($scores);
            $median = $count % 2 ? $scores[intdiv($count, 2)] : ($scores[$count / 2 - 1] + $scores[$count / 2]) / 2;
            $this->info(sprintf(
                'Probe scores over %d published articles: min %.4f, median %.4f, max %.4f.',
                $count,
                $scores[0],
                $median,
                $scores[$count - 1]
            ));
        } else {
            $this->warn('No published article produced a probe score.');
        }

        if ($failed > 0) {
            $this->warn("{$failed} article(s) failed. Fix them with Retry on the Knowledge Base page, or edit them.");

            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    /**
     * Store the probe on the article so the KB page shows the latest score and rank.
     */
    protected function recordProbe(KbArticle $article, array $probe): void
    {
        $article->refresh();
        $history = is_array($article->history) ? $article->history : [];
        $history[] = [
            'id' => (string) Str::uuid(),
            'type' => 'reindexed',
            'timestamp' => now()->format('Y-m-d H:i:s'),
            'actor' => 'kb:reembed',
            'action' => 'Re-embedded',
            'details' => 'Embedded again with the current model and probed for retrievability.',
            'probe' => $probe,
        ];
        $article->history = $history;
        $article->probe_score = $probe['score'];
        $article->save();
    }
}
