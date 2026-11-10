<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;
use Illuminate\Foundation\Validation\ValidatesRequests;
use Illuminate\Routing\Controller as BaseController;

class Controller extends BaseController
{
    use AuthorizesRequests, ValidatesRequests;

    /**
     * Validate that end date (`date_to`) is not earlier than start date (`date_from`).
     */
    protected function validateDateRange(?string $dateFrom, ?string $dateTo): ?\Illuminate\Http\JsonResponse
    {
        if (!empty($dateFrom) && !empty($dateTo)) {
            try {
                $from = \Carbon\Carbon::parse($dateFrom)->startOfDay();
                $to = \Carbon\Carbon::parse($dateTo)->startOfDay();
                if ($to->lt($from)) {
                    return response()->json([
                        'status' => 'error',
                        'message' => 'End date cannot be earlier than start date.',
                        'errors' => ['date_to' => ['End date cannot be earlier than start date.']],
                    ], 422);
                }
            } catch (\Throwable $e) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Invalid date format provided.',
                    'errors' => ['date_to' => ['Invalid date format provided.']],
                ], 422);
            }
        }

        return null;
    }
}
