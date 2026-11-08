<?php

namespace App\Console\Commands;

use App\Http\Controllers\AttachmentController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Spec 0037 (AC-6): move every stored file from the legacy public disk to the private
 * attachments disk, keeping the same relative file_path, so database rows stay valid.
 *
 * Safe to rerun: a file already present on the target disk is skipped (its leftover
 * source copy is removed only when the bytes match). --dry-run reports without touching
 * anything; --reverse moves files back (rollback).
 */
class MoveAttachmentsToPrivate extends Command
{
    protected $signature = 'attachments:move-to-private
                            {--dry-run : Report what would move without changing anything}
                            {--reverse : Move files back from the private disk to the public disk (rollback)}';

    protected $description = 'Move stored attachments from the public disk to the private attachments disk (spec 0037).';

    public function handle(): int
    {
        $reverse = (bool) $this->option('reverse');
        $dryRun = (bool) $this->option('dry-run');

        $from = Storage::disk($reverse ? AttachmentController::DISK : AttachmentController::LEGACY_DISK);
        $to = Storage::disk($reverse ? AttachmentController::LEGACY_DISK : AttachmentController::DISK);

        $moved = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($from->allFiles() as $path) {
            // Never relocate dotfiles such as .gitignore.
            if (str_starts_with(basename($path), '.')) {
                continue;
            }

            if ($to->exists($path)) {
                $skipped++;
                if (!$dryRun && $to->size($path) === $from->size($path)
                    && hash_equals((string) hash('sha256', (string) $to->get($path)), (string) hash('sha256', (string) $from->get($path)))) {
                    $from->delete($path);
                }
                continue;
            }

            if ($dryRun) {
                $this->line("would move: {$path}");
                $moved++;
                continue;
            }

            try {
                $stream = $from->readStream($path);
                if ($stream === null || $stream === false || !$to->writeStream($path, $stream)) {
                    throw new \RuntimeException('write failed');
                }
                if (is_resource($stream)) {
                    fclose($stream);
                }
                $from->delete($path);
                $moved++;
            } catch (\Throwable $e) {
                $failed++;
                $this->error("failed: {$path} ({$e->getMessage()})");
            }
        }

        $verb = $dryRun ? 'Would move' : 'Moved';
        $this->info("{$verb} {$moved} file(s); skipped {$skipped} already on the target disk; {$failed} failed.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
