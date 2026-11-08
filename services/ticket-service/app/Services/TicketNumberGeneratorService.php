<?php

namespace App\Services;

use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class TicketNumberGeneratorService
{
    /** @var array<int, string> Per-request memo of ticket_ID => ticket_number */
    private static array $refCache = [];

    /**
     * Resolve the display reference for a ticket from its persisted ticket_number.
     * Falls back to the legacy TKT-#### form only when no number was ever stored.
     */
    public static function refFor(int|string|null $ticketId, ?string $ticketNumber = null): string
    {
        $id = (int) $ticketId;
        if (!empty($ticketNumber)) {
            return self::$refCache[$id] = $ticketNumber;
        }
        if ($id <= 0) {
            return 'Ticket';
        }
        if (isset(self::$refCache[$id])) {
            return self::$refCache[$id];
        }

        $stored = null;
        try {
            $stored = DB::table('tickets')->where('ticket_ID', $id)->value('ticket_number');
        } catch (\Throwable $e) {
            Log::warning("Failed to resolve ticket_number for ticket {$id}: " . $e->getMessage());
        }

        return self::$refCache[$id] = $stored ?: ('TKT-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT));
    }

    /**
     * Generate the next unique ticket number based on active format configuration.
     * Guaranteed to be concurrency-safe via pessimistic row locking in a dedicated sequence table.
     *
     * @param string|null $departmentCode Optional departmental or branch identifier
     * @param DateTimeInterface|null $date Reference creation date (defaults to now)
     * @return string
     */
    public function generateNextTicketNumber(?string $departmentCode = null, ?DateTimeInterface $date = null): string
    {
        $config = TicketConfigurationService::getNumberFormatConfig();

        $prefix = strtoupper(trim($config['prefix'] ?? 'TKT'));
        if (empty($prefix)) {
            $prefix = 'TKT';
        }

        $includeDept = (bool) ($config['includeDeptCode'] ?? false);
        $dept = null;
        if ($includeDept) {
            // The SuperAdmin-configured code is authoritative. A caller-supplied code is only
            // used as a fallback, sanitized to the same structural rules as the configured one.
            $configured = strtoupper(trim((string) ($config['deptCode'] ?? '')));
            $fallback = strtoupper(preg_replace('/[^A-Za-z0-9_-]/', '', (string) $departmentCode) ?? '');
            $resolved = $configured !== '' ? $configured : $fallback;
            $dept = substr($resolved !== '' ? $resolved : 'DEPT', 0, 16);
        }

        $dateSegment = $config['dateSegment'] ?? 'none';
        $digitLength = (int) ($config['digitLength'] ?? 4);
        if ($digitLength < 3 || $digitLength > 8) {
            $digitLength = 4;
        }

        $sequenceNumber = $this->getNextSequenceNumber('global');

        return $this->assembleTicketNumber(
            $prefix,
            $dept,
            $dateSegment,
            $digitLength,
            $sequenceNumber,
            $date ?? now()
        );
    }

    /**
     * Assembles the ticket number string given the components.
     */
    public function assembleTicketNumber(
        string $prefix,
        ?string $deptCode,
        string $dateSegment,
        int $digitLength,
        int $sequence,
        DateTimeInterface $date
    ): string {
        $parts = [$prefix];

        if (!empty($deptCode)) {
            $parts[] = $deptCode;
        }

        if ($dateSegment === 'YYYY') {
            $parts[] = $date->format('Y');
        } elseif ($dateSegment === 'YYYYMM') {
            $parts[] = $date->format('Ym');
        } elseif ($dateSegment === 'YYYYMMDD') {
            $parts[] = $date->format('Ymd');
        }

        $parts[] = str_pad((string) $sequence, $digitLength, '0', STR_PAD_LEFT);

        return implode('-', $parts);
    }

    /**
     * Concurrency-safe atomic sequence incrementer with pessimistic locking.
     */
    public function getNextSequenceNumber(string $scope = 'global'): int
    {
        return DB::transaction(function () use ($scope) {
            $row = DB::table('ticket_sequences')
                ->where('scope', $scope)
                ->lockForUpdate()
                ->first();

            if (!$row) {
                $initialValue = (int) (DB::table('tickets')->max('ticket_ID') ?? 0);
                $next = $initialValue + 1;

                DB::table('ticket_sequences')->insert([
                    'scope' => $scope,
                    'current_value' => $next,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                return $next;
            }

            $next = ((int) $row->current_value) + 1;

            DB::table('ticket_sequences')
                ->where('scope', $scope)
                ->update([
                    'current_value' => $next,
                    'updated_at' => now(),
                ]);

            return $next;
        }, 5);
    }
}
