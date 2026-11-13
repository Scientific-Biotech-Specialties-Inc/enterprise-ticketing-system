<?php

namespace App\Services;

use App\Helpers\RoleHelper;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Proof of completion review gate (spec 0038 AC-30 to AC-33).
 *
 * CS must open every proof file of the latest submission before approving it.
 * Each open is recorded as a ticket_audit_logs row (action_type proof_viewed,
 * attachment_id in details). A move from Pending Evaluation to Resolved or Closed
 * by CS or admin is refused until the acting user has a view row for every proof
 * file created after the latest employee Pending Evaluation submission.
 *
 * Proof files come from attachment-service (GET /api/attachments?assignment_id=),
 * never from another service's tables. When attachment-service cannot be reached,
 * approval is blocked (safer than approving unchecked).
 */
class ProofReviewService
{
    public const STATUS_PENDING_EVALUATION = 6;
    public const STATUS_RESOLVED = 3;
    public const STATUS_CLOSED = 4;

    /**
     * Proof files of the ticket's active assignments, as [id => name].
     * Returns null when attachment-service cannot be reached.
     *
     * @return array<int,string>|null
     */
    public function proofFiles(int $ticketId): ?array
    {
        $assignmentIds = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->whereNull('completed_at')
            ->pluck('assignment_ID')
            ->all();

        $files = [];
        $baseUrl = rtrim((string) config('services.attachment.url', 'http://attachment-service:8000'), '/');
        foreach ($assignmentIds as $assignmentId) {
            try {
                $resp = Http::timeout(5)->get("{$baseUrl}/api/attachments", ['assignment_id' => (int) $assignmentId]);
            } catch (\Throwable $e) {
                Log::warning("Proof gate: attachment-service unreachable for assignment {$assignmentId}: " . $e->getMessage());
                return null;
            }
            if (!$resp->successful()) {
                return null;
            }
            foreach ((array) ($resp->json('attachments') ?? []) as $att) {
                if (isset($att['id'])) {
                    $files[(int) $att['id']] = (string) ($att['name'] ?? ('File #' . $att['id']));
                }
            }
        }

        return $files;
    }

    /**
     * When the latest proof submission happened: the latest employee audit row that
     * moved the ticket to Pending Evaluation (status_change) or uploaded proof.
     */
    public function latestSubmissionAt(int $ticketId): ?Carbon
    {
        $rows = DB::table('ticket_audit_logs')
            ->where('ticket_ID', $ticketId)
            ->where('actor_type', 'employee')
            ->whereIn('action_type', ['status_change', 'proof_uploaded'])
            ->orderByDesc('created_at')
            ->orderByDesc('log_ID')
            ->limit(50)
            ->get(['action_type', 'details', 'created_at']);

        foreach ($rows as $row) {
            if ($row->action_type === 'proof_uploaded') {
                return Carbon::parse($row->created_at);
            }
            $details = json_decode((string) $row->details, true) ?: [];
            if (strtolower((string) ($details['status'] ?? '')) === 'pending evaluation') {
                return Carbon::parse($row->created_at);
            }
        }

        return null;
    }

    /**
     * Attachment ids this user has viewed since the latest submission.
     *
     * @return int[]
     */
    public function viewedAttachmentIds(int $ticketId, int $actorId): array
    {
        $since = $this->latestSubmissionAt($ticketId);
        $query = DB::table('ticket_audit_logs')
            ->where('ticket_ID', $ticketId)
            ->where('action_type', 'proof_viewed')
            ->where('action_by_ID', $actorId);
        if ($since) {
            $query->where('created_at', '>=', $since);
        }

        return $query->pluck('details')
            ->map(fn ($d) => (int) ((json_decode((string) $d, true) ?: [])['attachment_id'] ?? 0))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Record that the acting CS or admin user opened a proof file (AC-31).
     *
     * @return array{status:int,data:array}
     */
    public function recordView(int $ticketId, int $attachmentId, $user): array
    {
        if (!$user || $user instanceof \App\Models\Client || !RoleHelper::isCsOrAdmin($user)) {
            return ['status' => 403, 'data' => ['message' => 'Only Customer Service or Administrators can review proof of completion.']];
        }

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first(['ticket_ID', 'ticket_status_ID']);
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found.']];
        }
        if ((int) $ticket->ticket_status_ID !== self::STATUS_PENDING_EVALUATION) {
            return ['status' => 422, 'data' => ['message' => 'Proof can only be reviewed while the ticket is Pending Evaluation.']];
        }

        $files = $this->proofFiles($ticketId);
        if ($files === null) {
            return ['status' => 503, 'data' => ['message' => 'Proof files cannot be verified right now. Please try again later.']];
        }
        if (!array_key_exists($attachmentId, $files)) {
            return ['status' => 422, 'data' => ['message' => 'That file is not a proof of completion for this ticket.']];
        }

        $actorId = (int) ($user->emp_id ?? $user->id ?? 0);
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => 'proof_viewed',
            'action_by_ID' => $actorId ?: null,
            'actor_type' => 'employee',
            'details' => json_encode([
                'attachment_id' => $attachmentId,
                'file_name' => $files[$attachmentId],
            ]),
            'created_at' => now(),
        ]);

        $viewed = $this->viewedAttachmentIds($ticketId, $actorId);

        return [
            'status' => 200,
            'data' => [
                'viewed_attachment_ids' => $viewed,
                'all_viewed' => count(array_diff(array_keys($files), $viewed)) === 0,
            ],
        ];
    }

    /**
     * AC-32 / AC-33: refuse a CS move from Pending Evaluation to Resolved or Closed
     * until the acting user has viewed every proof file of the latest submission.
     * Returns a response payload when blocked, or null when the move may continue.
     */
    public function approvalGateError(object $ticket, int $targetStatusId, $user): ?array
    {
        if ((int) $ticket->ticket_status_ID !== self::STATUS_PENDING_EVALUATION) {
            return null;
        }
        if (!in_array($targetStatusId, [self::STATUS_RESOLVED, self::STATUS_CLOSED], true)) {
            return null;
        }
        if (!$user || $user instanceof \App\Models\Client || !RoleHelper::isCsOrAdmin($user)) {
            return null;
        }

        $files = $this->proofFiles((int) $ticket->ticket_ID);
        if ($files === null) {
            return ['status' => 503, 'data' => [
                'message' => 'Proof files cannot be verified right now, so approval is blocked. Please try again later.',
                'code' => 'PROOF_CHECK_UNAVAILABLE',
            ]];
        }
        if (empty($files)) {
            return ['status' => 422, 'data' => [
                'message' => 'No proof of completion was uploaded. Reject the proof instead of approving it.',
                'code' => 'PROOF_NOT_VIEWED',
                'unviewed_files' => [],
            ]];
        }

        $actorId = (int) ($user->emp_id ?? $user->id ?? 0);
        $viewed = $this->viewedAttachmentIds((int) $ticket->ticket_ID, $actorId);
        $unviewed = array_values(array_diff_key($files, array_flip($viewed)));
        if (!empty($unviewed)) {
            return ['status' => 422, 'data' => [
                'message' => 'Open each proof of completion file before approving it.',
                'code' => 'PROOF_NOT_VIEWED',
                'unviewed_files' => $unviewed,
            ]];
        }

        return null;
    }
}
