<?php

namespace App\Services;

use Exception;
use Illuminate\Support\Facades\Log;

class ClamAVScanner
{
    protected string $host;
    protected int $port;
    protected int $timeout;

    public function __construct()
    {
        $this->host = config('services.clamav.host', 'clamav');
        $this->port = (int) config('services.clamav.port', 3310);
        $this->timeout = 30; // 30 seconds
    }

    /**
     * Scan a file path and return detailed result including detected threat name (TS084, TS085).
     * Returns ['clean' => bool, 'threat' => ?string, 'raw' => string].
     * Throws exception on connection or system error.
     */
    public function scanDetails(string $filePath): array
    {
        if (!file_exists($filePath)) {
            throw new Exception("File not found: " . $filePath);
        }

        $socket = @fsockopen($this->host, $this->port, $errno, $errstr, $this->timeout);
        if (!$socket) {
            Log::error("ClamAV socket connection failed: [{$errno}] {$errstr} (Host: {$this->host}:{$this->port})");
            throw new Exception("Could not connect to virus scanner service. Please try again later.");
        }

        // Set stream timeout
        stream_set_timeout($socket, $this->timeout);

        try {
            // Send INSTREAM command (zINSTREAM uses null byte ending, nINSTREAM uses newline ending)
            fwrite($socket, "zINSTREAM\0");

            $handle = fopen($filePath, 'rb');
            if (!$handle) {
                throw new Exception("Failed to open file for scanning: " . $filePath);
            }

            while (!feof($handle)) {
                $chunk = fread($handle, 8192);
                $length = strlen($chunk);
                if ($length > 0) {
                    // Send chunk length as a 4-byte big-endian unsigned integer
                    fwrite($socket, pack('N', $length));
                    // Send chunk data
                    fwrite($socket, $chunk);
                }
            }
            fclose($handle);

            // Send zero-length chunk to signal end of stream
            fwrite($socket, pack('N', 0));

            // Read response
            $response = '';
            while (!feof($socket)) {
                $response .= fgets($socket, 1024);
            }

            $response = trim($response);
            Log::info("ClamAV Scan response for file: {$response}");

            if (str_contains($response, 'FOUND')) {
                Log::warning("Virus detected in file {$filePath}: {$response}");
                $threat = 'Malware.Detected';
                if (preg_match('/:\s*(.+?)\s+FOUND/i', $response, $matches)) {
                    $threat = trim($matches[1]);
                }
                return [
                    'clean' => false,
                    'threat' => $threat,
                    'raw' => $response,
                ];
            }

            if (str_contains($response, 'OK')) {
                return [
                    'clean' => true,
                    'threat' => null,
                    'raw' => $response,
                ];
            }

            // If we got an error from ClamAV
            Log::error("ClamAV scanner returned error response: {$response}");
            throw new Exception("Virus scanner error: " . $response);

        } finally {
            fclose($socket);
        }
    }

    /**
     * Scan a file path.
     * Returns true if clean, false if virus found.
     * Throws exception on connection or system error.
     */
    public function scan(string $filePath): bool
    {
        $details = $this->scanDetails($filePath);
        return $details['clean'];
    }
}
