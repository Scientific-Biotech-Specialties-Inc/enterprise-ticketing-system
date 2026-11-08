<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\TicketAttachment;
use App\Models\ProofOfCompletion;
use App\Services\AttachmentAccessClient;
use App\Services\ClamAVScanner;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AttachmentController extends Controller
{
    /** Private disk holding every attachment and proof (spec 0037). */
    public const DISK = 'attachments';
    /** Legacy public disk, read only during the phase 1 migration fallback. */
    public const LEGACY_DISK = 'public';

    protected ClamAVScanner $scanner;
    protected AttachmentAccessClient $access;

    public function __construct(ClamAVScanner $scanner, AttachmentAccessClient $access)
    {
        $this->scanner = $scanner;
        $this->access = $access;
    }

    /**
     * The caller's bearer token: the Authorization header, else the access_token cookie
     * (the same two sources ticket-service auth.subsystem accepts).
     */
    protected function callerBearer(Request $request): ?string
    {
        $token = $request->bearerToken();
        if (!$token) {
            $token = $request->cookie('access_token');
        }
        return $token ? (string) $token : null;
    }

    /** Gateway URL the SPA uses to open a stored file. */
    public static function fileUrl(string $filePath): string
    {
        return '/api/ticketing/attachment/download/' . ltrim($filePath, '/');
    }

    /**
     * Which disk holds the file: the private disk first, then the legacy public disk.
     */
    protected function diskFor(string $path): ?string
    {
        if (Storage::disk(self::DISK)->exists($path)) {
            return self::DISK;
        }
        if (Storage::disk(self::LEGACY_DISK)->exists($path)) {
            return self::LEGACY_DISK;
        }
        return null;
    }

    /**
     * Move a stored file, wherever it lives today, to $newPath on the private disk.
     */
    protected function moveToPrivate(string $oldPath, string $newPath): void
    {
        if (Storage::disk(self::DISK)->exists($oldPath)) {
            Storage::disk(self::DISK)->move($oldPath, $newPath);
            return;
        }
        if (Storage::disk(self::LEGACY_DISK)->exists($oldPath)) {
            Storage::disk(self::DISK)->put($newPath, Storage::disk(self::LEGACY_DISK)->get($oldPath));
            Storage::disk(self::LEGACY_DISK)->delete($oldPath);
        }
    }

    /**
     * Resolve whether the caller may read $path (spec 0037, AC-1 to AC-4).
     *
     * @return array{0: ?\Illuminate\Http\JsonResponse, 1: ?object, 2: ?string}
     *         [error response or null, matching attachment/proof row, disk name]
     */
    protected function resolveFileAccess(Request $request, string $path): array
    {
        $notFound = response()->json(['message' => 'File not found'], 404);
        $cleanPath = ltrim($path, '/');

        if ($cleanPath === '' || str_contains($cleanPath, '..') || str_contains($cleanPath, "\0")) {
            return [$notFound, null, null];
        }
        if (str_starts_with($cleanPath, 'quarantine') || str_contains($cleanPath, 'quarantine/')) {
            return [response()->json(['message' => 'Access denied: Quarantined files cannot be accessed or downloaded.'], 403), null, null];
        }

        $bearer = $this->callerBearer($request);
        if (!$bearer) {
            return [response()->json(['message' => 'Unauthenticated.'], 401), null, null];
        }

        $row = TicketAttachment::where('file_path', $cleanPath)->first();
        $ticketId = $row?->ticket_id;
        $assignmentId = null;
        if (!$row) {
            $row = ProofOfCompletion::where('file_path', $cleanPath)->first();
            $assignmentId = $row?->assignment_ID;
        }
        if (!$row) {
            return [$notFound, null, null];
        }

        $isPending = $ticketId === null && $assignmentId === null;
        $decision = $isPending
            ? $this->access->check($bearer)
            : $this->access->check($bearer, $ticketId !== null ? (int) $ticketId : null, $assignmentId !== null ? (int) $assignmentId : null);

        if ($decision === AttachmentAccessClient::UNAUTHENTICATED) {
            return [response()->json(['message' => 'Unauthenticated.'], 401), null, null];
        }
        if ($decision === AttachmentAccessClient::UNAVAILABLE) {
            return [response()->json(['message' => 'File access cannot be verified right now. Please try again later.'], 503), null, null];
        }
        if (!is_array($decision)) {
            return [$notFound, null, null];
        }

        $allowed = $isPending
            ? ($row->uploaded_by_id !== null
                && (int) $row->uploaded_by_id === (int) $decision['user_id']
                && (string) $row->uploaded_by_type === (string) $decision['user_type'])
            : (bool) $decision['allowed'];

        if (!$allowed) {
            return [$notFound, null, null];
        }

        $disk = $this->diskFor($cleanPath);
        if ($disk === null) {
            return [$notFound, null, null];
        }

        return [null, $row, $disk];
    }

    /**
     * File responses default to public caching; force private, no-store so shared proxies never keep a copy.
     */
    protected function markPrivate($response)
    {
        if (method_exists($response, 'setPrivate')) {
            $response->setPrivate();
        }
        $response->headers->set('Cache-Control', 'private, no-store');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        return $response;
    }

    /** Headers for every file response: never cached by shared proxies, never sniffed. */
    protected function privateFileHeaders(?string $mime = null): array
    {
        return array_filter([
            'Content-Type' => $mime,
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * Retrieve active file upload constraints and malware scanning toggle from configuration-service.
     * Caches locally for 30s for ultra-fast performance with seamless fallback.
     */
    protected function getFileLimitsConfig(): array
    {
        $defaults = [
            'maxFileSizeMB' => 15,
            'allowedFileTypes' => ['PDF', 'DOCX', 'DOC', 'JPG', 'JPEG', 'PNG'],
            'maxFileCount' => 5,
            'malwareScanningEnabled' => true,
        ];

        try {
            return Cache::remember('ticket:config:file_limits', 30, function () use ($defaults) {
                $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                $response = Http::timeout(5)->get("{$configUrl}/api/ticket-configurations/file_limits");

                if ($response->successful()) {
                    $json = $response->json();
                    $val = $json['value'] ?? $json;
                    if (is_array($val)) {
                        return [
                            'maxFileSizeMB' => isset($val['maxFileSizeMB']) ? (float)$val['maxFileSizeMB'] : $defaults['maxFileSizeMB'],
                            'allowedFileTypes' => isset($val['allowedFileTypes']) && is_array($val['allowedFileTypes'])
                                ? array_values(array_unique(array_map('strtoupper', $val['allowedFileTypes'])))
                                : $defaults['allowedFileTypes'],
                            'maxFileCount' => isset($val['maxFileCount']) ? (int)$val['maxFileCount'] : $defaults['maxFileCount'],
                            'malwareScanningEnabled' => isset($val['malwareScanningEnabled']) ? (bool)$val['malwareScanningEnabled'] : $defaults['malwareScanningEnabled'],
                        ];
                    }
                }

                return $defaults;
            });
        } catch (\Throwable $e) {
            Log::warning("Failed to fetch file limits from configuration-service: " . $e->getMessage());
            return $defaults;
        }
    }

    /**
     * Upload and scan files enforcing system-wide file upload limits.
     * Applies only to new file uploads; historical ticket attachments are preserved.
     */
    public function upload(Request $request)
    {
        $config = $this->getFileLimitsConfig();
        $maxFileSizeMB = (float) ($config['maxFileSizeMB'] ?? 15);
        $maxFileCount = (int) ($config['maxFileCount'] ?? 5);
        $allowedFileTypes = $config['allowedFileTypes'] ?? ['PDF', 'DOCX', 'DOC', 'JPG', 'JPEG', 'PNG'];
        $malwareScanningEnabled = (bool) ($config['malwareScanningEnabled'] ?? true);

        $request->validate([
            'attachments' => 'required|array',
            'is_proof' => 'nullable|string' // 'true' or 'false'
        ]);

        $files = $request->file('attachments');
        if (!is_array($files)) {
            return response()->json([
                'message' => 'Attachments must be provided as an array.',
                'errors' => ['attachments' => ['Attachments must be provided as an array.']]
            ], 422);
        }

        // 1. Enforce file count restriction
        if (count($files) > $maxFileCount) {
            return response()->json([
                'message' => "Upload limit exceeded: You can upload a maximum of {$maxFileCount} files at a time.",
                'errors' => [
                    'attachments' => ["A maximum of {$maxFileCount} files can be uploaded at a time."]
                ]
            ], 422);
        }

        $maxFileSizeBytes = (int) round($maxFileSizeMB * 1024 * 1024);
        $allowedUpper = array_map('strtoupper', $allowedFileTypes);

        // 2. Pre-validate size and allowed types on each file before saving or scanning
        foreach ($files as $file) {
            if (!$file || !$file->isValid()) {
                return response()->json([
                    'message' => 'Invalid file upload encountered.',
                    'errors' => ['attachments' => ['One or more files failed to upload cleanly.']]
                ], 422);
            }

            if ($file->getSize() > $maxFileSizeBytes) {
                $fileName = $file->getClientOriginalName();
                return response()->json([
                    'message' => "File '{$fileName}' exceeds the maximum allowed size of {$maxFileSizeMB} MB.",
                    'errors' => [
                        'attachments' => ["File '{$fileName}' exceeds the limit of {$maxFileSizeMB} MB."]
                    ]
                ], 422);
            }

            $ext = strtoupper($file->getClientOriginalExtension());
            if (!in_array($ext, $allowedUpper, true)) {
                $fileName = $file->getClientOriginalName();
                return response()->json([
                    'message' => "File type '.{$ext}' is not permitted for '{$fileName}'. Allowed formats: " . implode(', ', $allowedFileTypes) . ".",
                    'errors' => [
                        'attachments' => ["File extension '.{$ext}' is not permitted."]
                    ]
                ], 422);
            }
        }

        $isProof = filter_var($request->input('is_proof', false), FILTER_VALIDATE_BOOLEAN);
        $uploaded = [];
        $quarantined = [];

        // Spec 0037 (AC-4): resolve the verified uploader before anything is scanned or stored.
        $bearer = $this->callerBearer($request);
        $identity = $this->access->check($bearer);
        if ($identity === AttachmentAccessClient::UNAVAILABLE) {
            return response()->json(['message' => 'Unable to verify your identity right now. Please try again later.'], 503);
        }
        if (!is_array($identity)) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // A chat upload names its ticket. Bind it to that ticket straight away when the
        // uploader belongs to it, so every participant (not only the uploader) can open it.
        $bindTicketId = null;
        $requestedTicketId = $request->input('ticket_id');
        if (!$isProof && is_numeric($requestedTicketId) && (int) $requestedTicketId > 0) {
            $ticketDecision = $this->access->check($bearer, (int) $requestedTicketId);
            if (is_array($ticketDecision) && $ticketDecision['allowed']) {
                $bindTicketId = (int) $requestedTicketId;
            }
        }

        try {
            foreach ($files as $file) {
                $origName = $file->getClientOriginalName();
                $safeName = basename(preg_replace('/[^a-zA-Z0-9_.-]/', '_', $origName));
                $uuid = Str::uuid()->toString();

                // Save temporarily to perform scan on disk path
                $tempPath = $file->storeAs("temp-scans", "{$uuid}_{$safeName}", 'local');
                $fullTempPath = Storage::disk('local')->path($tempPath);

                // 3. Conditional Malware Scanning via ClamAV (TS084, TS085)
                if ($malwareScanningEnabled) {
                    try {
                        $scanDetails = $this->scanner->scanDetails($fullTempPath);
                    } catch (\Exception $e) {
                        @unlink($fullTempPath);
                        Log::error("ClamAV Scanning failed with exception: " . $e->getMessage());
                        return response()->json([
                            'message' => 'Unable to verify file security. Please try again later.'
                        ], 500);
                    }

                    if (!$scanDetails['clean']) {
                        $quarantined[] = $this->handleMalwareQuarantineAndAlert(
                            $request,
                            $origName,
                            $fullTempPath,
                            $file->getSize(),
                            $scanDetails['threat'] ?? 'Malware.Detected',
                            $uuid
                        );
                        continue; // Proceed with next file for partial-upload support!
                    }
                } else {
                    Log::info("Malware scanning disabled by system configuration. Bypassing ClamAV scan for {$origName}");
                }

                // Move the clean file (already scanned above) from the local temp area to the private disk.
                $pendingPath = $bindTicketId !== null
                    ? "ticket-attachments/{$bindTicketId}/{$uuid}_{$safeName}"
                    : "ticket-attachments/pending/{$uuid}/{$safeName}";
                Storage::disk(self::DISK)->put($pendingPath, file_get_contents($fullTempPath));
                @unlink($fullTempPath); // delete local temp file

                $uploader = [
                    'uploaded_by_id' => $identity['user_id'],
                    'uploaded_by_type' => $identity['user_type'],
                ];

                if ($isProof) {
                    $record = ProofOfCompletion::create([
                        'assignment_ID' => null,
                        'file_name' => $safeName,
                        'file_path' => $pendingPath,
                        'file_type' => $file->getClientMimeType(),
                        'file_size' => $file->getSize(),
                        'uploaded_at' => now(),
                    ] + $uploader);

                    $uploaded[] = [
                        'id' => $record->proof_ID,
                        'name' => $safeName,
                        'url' => self::fileUrl($pendingPath),
                        'file_path' => $pendingPath,
                        'file_type' => $record->file_type,
                        'file_size' => $record->file_size,
                        'is_proof' => true
                    ];
                } else {
                    $record = TicketAttachment::create([
                        'ticket_id' => $bindTicketId,
                        'file_name' => $safeName,
                        'file_path' => $pendingPath,
                        'file_type' => $file->getClientMimeType(),
                        'uploaded_at' => now(),
                    ] + $uploader);

                    $uploaded[] = [
                        'id' => $record->attachment_id,
                        'name' => $safeName,
                        'url' => self::fileUrl($pendingPath),
                        'file_path' => $pendingPath,
                        'file_type' => $record->file_type,
                        'file_size' => $file->getSize(),
                        'is_proof' => false
                    ];
                }
            }

            // 4. Partial-upload evaluation (TS084)
            $hasThreats = count($quarantined) > 0;
            $hasClean = count($uploaded) > 0;

            if ($hasThreats && !$hasClean) {
                return response()->json([
                    'message' => 'The uploaded file was flagged as a potential security risk and cannot be accepted. Please upload a clean file.',
                    'virus_detected' => true,
                    'has_threats' => true,
                    'attachments' => [],
                    'quarantined' => $quarantined,
                ], 422);
            }

            if ($hasThreats && $hasClean) {
                return response()->json([
                    'message' => 'Upload completed with security warnings: Clean files were processed successfully, while infected files were blocked and quarantined.',
                    'virus_detected' => true,
                    'has_threats' => true,
                    'attachments' => $uploaded,
                    'quarantined' => $quarantined,
                ], 200);
            }

            return response()->json([
                'message' => 'Files uploaded successfully.',
                'virus_detected' => false,
                'has_threats' => false,
                'attachments' => $uploaded,
                'quarantined' => [],
            ], 200);

        } catch (\Exception $e) {
            Log::error("Attachment upload exception: " . $e->getMessage());
            return response()->json(['message' => 'Upload failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Quarantine infected file, write durable security audit log, and dispatch alerts (TS084, TS085).
     */
    protected function handleMalwareQuarantineAndAlert(
        Request $request,
        string $origName,
        string $fullTempPath,
        int $fileSize,
        string $threatName,
        string $uuid
    ): array {
        $safeName = basename(preg_replace('/[^a-zA-Z0-9_.-]/', '_', $origName));
        $fileHash = file_exists($fullTempPath) ? hash_file('sha256', $fullTempPath) : null;
        $quarantineRef = "quarantine/{$uuid}_{$safeName}";

        // 1. Quarantine isolation (stored in private local disk, completely isolated from public downloads)
        try {
            Storage::disk('local')->put($quarantineRef, file_get_contents($fullTempPath));
        } catch (\Throwable $e) {
            Log::error("Failed to write file to quarantine storage: " . $e->getMessage());
        } finally {
            @unlink($fullTempPath);
        }

        // 2. Identify uploader details
        $user = $request->user();
        $uploaderId = $user ? ($user->emp_id ?? $user->id) : null;
        $uploaderEmail = $user?->email ?? 'anonymous';
        $uploaderRole = $user?->role ?? ($user instanceof \App\Models\Client ? 'customer' : 'guest');
        $ip = $request->ip();
        $ticketId = $request->input('ticket_id');

        // 3. Security Audit Logging (TS084)
        Log::warning("SECURITY INCIDENT [MALWARE_QUARANTINED]: File='{$origName}', Size={$fileSize}, SHA256={$fileHash}, Threat='{$threatName}', Uploader={$uploaderEmail} (ID:{$uploaderId}, Role:{$uploaderRole}), IP={$ip}, TicketID={$ticketId}, QuarantineRef={$quarantineRef}");

        // 4. Incident payload (STRICTLY NO malware binary transmitted per TS085)
        $securityAlert = [
            'incident_id' => Str::uuid()->toString(),
            'event' => 'malware_detected',
            'alert_type' => 'security_alert',
            'timestamp' => now()->toIso8601String(),
            'uploader' => [
                'id' => $uploaderId,
                'email' => $uploaderEmail,
                'role' => $uploaderRole,
                'ip_address' => $ip,
            ],
            'ticket_id' => $ticketId ? (int) $ticketId : null,
            'file' => [
                'original_name' => $origName,
                'size' => $fileSize,
                'hash_sha256' => $fileHash,
                'threat_name' => $threatName,
                'quarantine_ref' => $quarantineRef,
            ],
        ];

        // 5. Dispatch incident alert to notification-service (TS085)
        try {
            $notifUrl = env('NOTIFICATION_SERVICE_URL', 'http://notification-service:8000');
            Http::timeout(3)->post("{$notifUrl}/api/security-alerts", $securityAlert);
        } catch (\Throwable $e) {
            Log::warning("Could not dispatch security incident alert to notification-service: " . $e->getMessage());
        }

        // 6. Durable in-app security notification for Super Admins and Admins (TS085)
        try {
            $adminIds = DB::table('employees')
                ->whereIn(DB::raw('LOWER(role)'), ['superadmin', 'super admin', 'admin'])
                ->pluck('emp_id');

            foreach ($adminIds as $adminId) {
                DB::table('notifications')->insert([
                    'recipient_id'   => $adminId,
                    'recipient_type' => 'employee',
                    'title'          => 'Security Alert: Malware Detected on Upload',
                    'message'        => "Potential threat '{$threatName}' detected in file '{$origName}' uploaded by {$uploaderEmail}. The file was quarantined.",
                    'ticket_id'      => $ticketId ? (int) $ticketId : null,
                    'data'           => json_encode($securityAlert),
                    'is_read'        => false,
                    'created_at'     => now(),
                    'updated_at'     => now(),
                ]);
            }
        } catch (\Throwable $e) {
            Log::warning("Could not record in-app security alert notifications: " . $e->getMessage());
        }

        return [
            'name' => $origName,
            'virus_detected' => true,
            'threat_name' => $threatName,
            'status' => 'quarantined',
            'quarantine_ref' => $quarantineRef,
            'message' => "The uploaded file was flagged as a potential security risk and cannot be accepted. Please upload a clean file.",
        ];
    }

    /**
     * Bind pending attachments to a Ticket or Assignment.
     */
    public function bind(Request $request)
    {
        $request->validate([
            'ticket_id' => 'nullable|integer',
            'assignment_id' => 'nullable|integer',
            'attachment_ids' => 'required|array',
            'attachment_ids.*' => 'integer',
            'is_proof' => 'nullable|boolean'
        ]);

        $isProof = $request->input('is_proof', false);
        $ticketId = $request->input('ticket_id');
        $assignmentId = $request->input('assignment_id');
        $attachmentIds = $request->input('attachment_ids');

        $bound = [];

        if ($isProof) {
            if (!$assignmentId) {
                return response()->json(['message' => 'assignment_id is required for proof binding.'], 400);
            }

            $attachments = ProofOfCompletion::whereIn('proof_ID', $attachmentIds)
                ->whereNull('assignment_ID')
                ->get();

            foreach ($attachments as $att) {
                $oldPath = $att->file_path;
                $newPath = "ticket-attachments/proofs/{$assignmentId}/" . basename($oldPath);

                $this->moveToPrivate($oldPath, $newPath);

                $att->update([
                    'assignment_ID' => $assignmentId,
                    'file_path' => $newPath
                ]);

                $bound[] = $att;
            }
        } else {
            if (!$ticketId) {
                return response()->json(['message' => 'ticket_id is required for ticket attachment binding.'], 400);
            }

            $attachments = TicketAttachment::whereIn('attachment_id', $attachmentIds)
                ->whereNull('ticket_id')
                ->get();

            foreach ($attachments as $att) {
                $oldPath = $att->file_path;
                $newPath = "ticket-attachments/{$ticketId}/" . basename($oldPath);

                $this->moveToPrivate($oldPath, $newPath);

                $att->update([
                    'ticket_id' => $ticketId,
                    'file_path' => $newPath
                ]);

                $bound[] = $att;
            }
        }

        return response()->json([
            'message' => 'Attachments bound successfully.',
            'bound_count' => count($bound),
            'file_names' => collect($bound)->pluck('file_name')->all()
        ], 200);
    }

    /**
     * Retrieve attachments for a Ticket or Assignment.
     */
    public function index(Request $request)
    {
        $ticketId = $request->query('ticket_id');
        $assignmentId = $request->query('assignment_id');

        if ($ticketId) {
            $attachments = TicketAttachment::where('ticket_id', $ticketId)->get();
            return response()->json([
                'attachments' => $attachments->map(function ($row) {
                    return [
                        'id' => $row->attachment_id,
                        'name' => $row->file_name,
                        'url' => str_starts_with($row->file_path, 'http') ? $row->file_path : self::fileUrl($row->file_path),
                        'file_type' => $row->file_type,
                        'uploaded_at' => $row->uploaded_at
                    ];
                })
            ]);
        }

        if ($assignmentId) {
            $attachments = ProofOfCompletion::where('assignment_ID', $assignmentId)->get();
            return response()->json([
                'attachments' => $attachments->map(function ($row) {
                    return [
                        'id' => $row->proof_ID,
                        'name' => $row->file_name,
                        'url' => str_starts_with($row->file_path, 'http') ? $row->file_path : self::fileUrl($row->file_path),
                        'file_type' => $row->file_type,
                        'size' => $row->file_size,
                        'uploaded_at' => $row->uploaded_at
                    ];
                })
            ]);
        }

        return response()->json(['message' => 'Specify ticket_id or assignment_id.'], 400);
    }

    /**
     * Delete an attachment.
     */
    public function destroy(Request $request, $id)
    {
        $isProof = filter_var($request->query('is_proof', false), FILTER_VALIDATE_BOOLEAN);

        if ($isProof) {
            $attachment = ProofOfCompletion::find($id);
            if ($attachment) {
                if ($attachment->file_path) {
                    Storage::disk(self::DISK)->delete($attachment->file_path);
                    Storage::disk(self::LEGACY_DISK)->delete($attachment->file_path);
                }
                $attachment->delete();
                return response()->json(['message' => 'Proof file deleted.']);
            }
        } else {
            $attachment = TicketAttachment::find($id);
            if ($attachment) {
                if ($attachment->file_path) {
                    Storage::disk(self::DISK)->delete($attachment->file_path);
                    Storage::disk(self::LEGACY_DISK)->delete($attachment->file_path);
                }
                $attachment->delete();
                return response()->json(['message' => 'Attachment file deleted.']);
            }
        }

        return response()->json(['message' => 'Attachment not found.'], 404);
    }

    /**
     * Serve an attachment inline for preview, after the spec 0037 access check.
     */
    public function serve(Request $request, $path)
    {
        [$error, $row, $disk] = $this->resolveFileAccess($request, (string) $path);
        if ($error) {
            return $error;
        }

        $cleanPath = ltrim((string) $path, '/');
        $mime = $row->file_type ?: (Storage::disk($disk)->mimeType($cleanPath) ?: 'application/octet-stream');

        return $this->markPrivate(response()->file(
            Storage::disk($disk)->path($cleanPath),
            $this->privateFileHeaders($mime)
        ));
    }

    /**
     * Download an attachment with a Content-Disposition header, after the spec 0037 access check.
     */
    public function download(Request $request, $path)
    {
        [$error, $row, $disk] = $this->resolveFileAccess($request, (string) $path);
        if ($error) {
            return $error;
        }

        $cleanPath = ltrim((string) $path, '/');
        $mime = $row->file_type ?: (Storage::disk($disk)->mimeType($cleanPath) ?: 'application/octet-stream');
        $filename = $row->file_name ?: basename($cleanPath);

        return $this->markPrivate(Storage::disk($disk)->download($cleanPath, $filename, $this->privateFileHeaders($mime)));
    }
}
