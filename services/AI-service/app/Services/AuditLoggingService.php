<?php

namespace App\Services;

use App\Events\ArticleDeleted;
use App\Models\KbAuditLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class AuditLoggingService
{
    /**
     * Record an article permanent deletion event independently of the article record.
     * Survives the complete hard-delete of the article and its embeddings.
     */
    public function logArticleDeletion(
        int $articleId,
        string $title,
        string $actor = 'Super Admin',
        string $actorRole = 'Super Admin',
        array $extraDetails = [],
        ?string $ipAddress = null
    ): KbAuditLog {
        $timestamp = now();
        $details = array_merge([
            'article_id' => $articleId,
            'title' => $title,
            'module' => 'Knowledge Base',
            'action' => 'Deleted',
            'actor' => $actor,
            'actor_role' => $actorRole,
            'text' => "Deleted knowledge article \"{$title}\" and permanently removed all index embeddings.",
        ], $extraDetails);

        // 1. Independent Knowledge Base Audit Log Table
        $logRecord = KbAuditLog::create([
            'article_id' => $articleId,
            'article_title' => $title,
            'action' => 'Deleted',
            'actor' => $actor,
            'actor_role' => $actorRole,
            'module' => 'Knowledge Base',
            'details' => $details,
            'ip_address' => $ipAddress,
        ]);

        // 2. Cross-Module System Audit Log Table (in shared database)
        try {
            $empId = DB::table('employees')
                ->where('role', 'like', '%admin%')
                ->value('emp_id')
                ?? DB::table('employees')->value('emp_id')
                ?? 1;

            DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => null,
                    'action_type' => 'kb_article_deleted',
                    'action_by_ID' => $empId,
                    'actor_type' => 'superadmin',
                    'details' => json_encode([
                        'module' => 'Knowledge Base',
                        'target' => $title,
                        'text' => "Permanently deleted knowledge article \"{$title}\" and purged AI search index.",
                        'user_name' => $actor,
                        'role' => $actorRole,
                        'article_id' => $articleId,
                    ]),
                    'created_at' => $timestamp,
                ]);
        } catch (\Throwable $e) {
            Log::warning('Could not write to ticket_audit_logs: ' . $e->getMessage());
        }

        // 3. Security Audit Logging
        Log::info("AUDIT LOG: [Knowledge Base] Article #{$articleId} (\"{$title}\") permanently deleted by {$actor} ({$actorRole}).", [
            'article_id' => $articleId,
            'title' => $title,
            'actor' => $actor,
            'actor_role' => $actorRole,
            'details' => $details,
            'ip' => $ipAddress,
        ]);

        // 4. Publish Event to Event Bus
        try {
            event(new ArticleDeleted(
                articleId: $articleId,
                title: $title,
                actor: $actor,
                occurredAt: $timestamp->toIso8601String(),
                category: $extraDetails['category'] ?? 'Knowledge Base',
                details: $details
            ));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting ArticleDeleted event failed: ' . $e->getMessage());
        }

        return $logRecord;
    }

    /**
     * Record a non destructive article change (metadata edit, file replacement)
     * in the independent kb_audit_logs table.
     *
     * Failures are logged and swallowed so an audit write never blocks the edit itself.
     */
    public function logArticleChange(
        int $articleId,
        string $title,
        string $action,
        string $actor = 'Super Admin',
        string $actorRole = 'Super Admin',
        array $details = [],
        ?string $ipAddress = null
    ): ?KbAuditLog {
        try {
            return KbAuditLog::create([
                'article_id' => $articleId,
                'article_title' => mb_substr($title, 0, 255),
                'action' => mb_substr($action, 0, 50),
                'actor' => mb_substr($actor, 0, 100),
                'actor_role' => mb_substr($actorRole, 0, 50),
                'module' => 'Knowledge Base',
                'details' => array_merge(['article_id' => $articleId, 'title' => $title, 'action' => $action], $details),
                'ip_address' => $ipAddress,
            ]);
        } catch (\Throwable $e) {
            Log::warning("Could not write kb_audit_logs entry ({$action}) for article #{$articleId}: " . $e->getMessage());
            return null;
        }
    }
}
