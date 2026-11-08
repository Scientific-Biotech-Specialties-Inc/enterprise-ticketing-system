<?php

namespace App\Services;

use App\Models\TicketDraft;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;

class TicketDraftService
{
    const MAX_DRAFTS_PER_CUSTOMER = 10;

    protected function ensureTable(): void
    {
        // Table schema is strictly governed and created by database migrations
    }

    public function saveDraft(int $clientId, array $data, ?int $draftId = null): array
    {
        $this->ensureTable();

        if ($draftId) {
            $draft = TicketDraft::where('id', $draftId)->where('client_id', $clientId)->first();
            if (!$draft) {
                return [
                    'success' => false,
                    'status' => 404,
                    'error' => 'DRAFT_NOT_FOUND',
                    'message' => 'Draft not found or you do not have permission to edit it.',
                ];
            }
        } else {
            $count = TicketDraft::where('client_id', $clientId)->count();
            if ($count >= self::MAX_DRAFTS_PER_CUSTOMER) {
                return [
                    'success' => false,
                    'status' => 422,
                    'error' => 'LIMIT_EXCEEDED',
                    'message' => 'You have reached the maximum allowed limit of ' . self::MAX_DRAFTS_PER_CUSTOMER . ' drafts. Please submit or delete an existing draft.',
                ];
            }
            $draft = new TicketDraft();
            $draft->client_id = $clientId;
        }

        if (array_key_exists('title', $data)) {
            $draft->title = $data['title'];
        }
        if (array_key_exists('description', $data)) {
            $draft->description = $data['description'];
        }
        if (array_key_exists('machine_ID', $data)) {
            $draft->machine_ID = !empty($data['machine_ID']) ? (int) $data['machine_ID'] : null;
        }
        if (array_key_exists('problem_category_ID', $data)) {
            $draft->problem_category_ID = !empty($data['problem_category_ID']) ? (int) $data['problem_category_ID'] : null;
        }
        if (array_key_exists('priority_ID', $data)) {
            $draft->priority_ID = !empty($data['priority_ID']) ? (int) $data['priority_ID'] : 1;
        }
        if (array_key_exists('attachments', $data)) {
            $draft->attachments = is_array($data['attachments']) ? $data['attachments'] : [];
        }

        $draft->save();

        Log::info("Ticket draft saved for client {$clientId}", [
            'draft_id' => $draft->id,
            'client_id' => $clientId,
        ]);

        return [
            'success' => true,
            'status' => 200,
            'message' => 'Draft saved successfully.',
            'draft' => $this->formatDraft($draft),
        ];
    }

    public function getDrafts(int $clientId): array
    {
        $this->ensureTable();

        $drafts = TicketDraft::where('client_id', $clientId)
            ->orderByDesc('updated_at')
            ->get();

        return $drafts->map(fn($d) => $this->formatDraft($d))->all();
    }

    public function getDraft(int $clientId, int $draftId): ?array
    {
        $this->ensureTable();

        $draft = TicketDraft::where('id', $draftId)->where('client_id', $clientId)->first();
        if (!$draft) {
            return null;
        }

        return $this->formatDraft($draft);
    }

    public function deleteDraft(int $clientId, int $draftId): bool
    {
        $this->ensureTable();

        $deleted = TicketDraft::where('id', $draftId)->where('client_id', $clientId)->delete();

        if ($deleted) {
            Log::info("Ticket draft {$draftId} deleted by client {$clientId}");
        }

        return (bool) $deleted;
    }

    protected function formatDraft(TicketDraft $draft): array
    {
        $title = trim($draft->title ?? '');
        return [
            'id' => $draft->id,
            'draft_id' => $draft->id,
            'title' => $title !== '' ? $title : 'Untitled draft',
            'raw_title' => $draft->title,
            'description' => $draft->description ?? '',
            'machine_ID' => $draft->machine_ID,
            'problem_category_ID' => $draft->problem_category_ID,
            'priority_ID' => $draft->priority_ID ?? 1,
            'attachments' => $draft->attachments ?? [],
            'created_at' => optional($draft->created_at)->toIso8601String(),
            'updated_at' => optional($draft->updated_at)->toIso8601String(),
            'last_saved_at' => optional($draft->updated_at)->toIso8601String(),
        ];
    }
}
