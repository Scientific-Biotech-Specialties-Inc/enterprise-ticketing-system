<?php

namespace App\Http\Controllers;

use App\Services\TicketNotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TicketNotificationController extends Controller
{
    protected TicketNotificationService $notificationService;

    public function __construct(TicketNotificationService $notificationService)
    {
        $this->notificationService = $notificationService;
    }

    /**
     * Get unread and recent notifications for the authenticated client/employee.
     */
    public function getNotifications(Request $request)
    {
        list($recipientId, $recipientType) = $this->notificationService->getRecipientInfo($request);
        if (!$recipientId) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $isClientRecipient = $recipientType === 'client';

        $notifications = DB::table('notifications')
            ->where('recipient_id', $recipientId)
            ->where('recipient_type', $recipientType)
            // Customers never receive reassignment notifications (internal handling).
            ->when($isClientRecipient, fn ($q) => $q->where('title', 'not like', '%reassign%')->where('message', 'not like', '%reassign%'))
            ->orderBy('created_at', 'desc')
            ->get()
            ->map(function ($n) {
                $n->is_read = (bool) $n->is_read;
                if (!empty($n->created_at)) {
                    $n->created_at = \Carbon\Carbon::parse($n->created_at)->toISOString();
                }
                if (!empty($n->updated_at)) {
                    $n->updated_at = \Carbon\Carbon::parse($n->updated_at)->toISOString();
                }
                return $n;
            });

        $unreadCount = DB::table('notifications')
            ->where('recipient_id', $recipientId)
            ->where('recipient_type', $recipientType)
            ->when($isClientRecipient, fn ($q) => $q->where('title', 'not like', '%reassign%')->where('message', 'not like', '%reassign%'))
            ->where('is_read', false)
            ->count();

        return response()->json([
            'notifications' => $notifications,
            'unread_count' => $unreadCount,
        ]);
    }

    /**
     * Mark all notifications as read for the authenticated client/employee.
     */
    public function markNotificationsRead(Request $request)
    {
        list($recipientId, $recipientType) = $this->notificationService->getRecipientInfo($request);
        if (!$recipientId) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        DB::table('notifications')
            ->where('recipient_id', $recipientId)
            ->where('recipient_type', $recipientType)
            ->update([
                'is_read' => true,
                'updated_at' => now(),
            ]);

        $this->notificationService->broadcastTicketChange('notifications_read', 0);

        return response()->json([
            'message' => 'All notifications marked as read.',
            'unread_count' => 0,
        ]);
    }

    /**
     * Mark an individual notification as read.
     */
    public function markNotificationRead(Request $request, int $id)
    {
        list($recipientId, $recipientType) = $this->notificationService->getRecipientInfo($request);
        if (!$recipientId) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        DB::table('notifications')
            ->where('id', $id)
            ->where('recipient_id', $recipientId)
            ->where('recipient_type', $recipientType)
            ->update([
                'is_read' => true,
                'updated_at' => now(),
            ]);

        $updatedNotification = DB::table('notifications')->where('id', $id)->first();

        $unreadCount = DB::table('notifications')
            ->where('recipient_id', $recipientId)
            ->where('recipient_type', $recipientType)
            ->where('is_read', false)
            ->count();

        $this->notificationService->broadcastTicketChange('notification_read', 0);

        return response()->json([
            'message' => 'Notification marked as read.',
            'notification' => $updatedNotification,
            'unread_count' => $unreadCount,
        ]);
    }
}
