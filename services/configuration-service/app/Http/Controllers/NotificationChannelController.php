<?php

namespace App\Http\Controllers;

use App\Models\NotificationChannel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class NotificationChannelController extends Controller
{
    /**
     * Helper to write configuration audit logs to ticket_audit_logs.
     */
    protected function logAudit(?Request $request, string $actionType, string $module, string $target, string $text): void
    {
        try {
            $userId = $request?->user()?->emp_id
                ?? $request?->user()?->id
                ?? DB::table('employees')->where('role', 'superadmin')->value('emp_id')
                ?? DB::table('employees')->value('emp_id')
                ?? 1;

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID'    => null,
                'action_type'  => $actionType,
                'action_by_ID' => $userId,
                'actor_type'   => 'superadmin',
                'details'      => json_encode([
                    'module' => $module,
                    'target' => $target,
                    'text'   => $text,
                ]),
                'created_at'   => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to record notification channel audit log: " . $e->getMessage());
        }
    }

    /**
     * Retrieves all notification channels and key-channel dictionary.
     */
    public function index()
    {
        $channels = NotificationChannel::orderBy('id')->get();

        // Build key => channel map for frontend state
        $channelMap = [];
        foreach ($channels as $c) {
            $channelMap[$c->alert_key] = $c->channel;
        }

        return response()->json([
            'channels'   => $channels->map->toApiResponse()->values(),
            'channelMap' => $channelMap,
        ]);
    }

    /**
     * Retrieves channel setting for a specific alert event.
     */
    public function show(string $alertKey)
    {
        $channel = NotificationChannel::where('alert_key', $alertKey)->firstOrFail();

        return response()->json([
            'channel' => $channel->toApiResponse(),
        ]);
    }

    /**
     * Updates channel for a specific alert event.
     */
    public function update(Request $request, string $alertKey)
    {
        $validated = $request->validate([
            'channel' => 'required|string|in:email,in_app,both',
        ], [
            'channel.required' => 'Delivery channel is required.',
            'channel.in'       => 'Delivery channel must be one of: email, in_app, or both.',
        ]);

        $channel = NotificationChannel::where('alert_key', $alertKey)->firstOrFail();
        $oldChannel = $channel->channel;
        $newChannel = $validated['channel'];

        $channel->update([
            'channel' => $newChannel,
        ]);

        $this->logAudit(
            $request,
            'config_update',
            'Notification Channels',
            $channel->title,
            "Updated delivery channel for '{$channel->title}' from '{$oldChannel}' to '{$newChannel}'"
        );

        return response()->json([
            'message' => "Delivery channel for \"{$channel->title}\" updated to \"{$newChannel}\".",
            'channel' => $channel->fresh()->toApiResponse(),
        ]);
    }

    /**
     * Updates all delivery channels in bulk.
     * Enforces strict validation that NO channel is left unselected or empty.
     */
    public function updateAll(Request $request)
    {
        $validated = $request->validate([
            'channels' => 'required|array|min:1',
        ], [
            'channels.required' => 'Notification channels configuration payload is required.',
            'channels.min'      => 'At least one notification channel configuration must be provided.',
        ]);

        $channelsData = $validated['channels'];
        $existingChannels = NotificationChannel::all()->keyBy('alert_key');

        if ($existingChannels->isEmpty()) {
            return response()->json([
                'message' => 'No notification channels defined in database.',
            ], 404);
        }

        // Validate that every known alert type has a valid non-empty channel
        $errors = [];
        foreach ($existingChannels as $key => $model) {
            $ch = $channelsData[$key] ?? null;
            if (empty($ch) || !in_array($ch, ['email', 'in_app', 'both'], true)) {
                $errors[$key] = "Please select a valid delivery channel (Email only, In-App only, or Both) for {$model->title}.";
            }
        }

        if (!empty($errors)) {
            return response()->json([
                'message' => 'Validation Error: Every alert type must have a valid delivery channel selected.',
                'errors'  => $errors,
            ], 422);
        }

        // Apply updates
        $updatedCount = 0;
        DB::transaction(function () use ($existingChannels, $channelsData, &$updatedCount) {
            foreach ($existingChannels as $key => $model) {
                $newChannel = $channelsData[$key];
                if ($model->channel !== $newChannel) {
                    $model->update(['channel' => $newChannel]);
                    $updatedCount++;
                }
            }
        });

        $this->logAudit(
            $request,
            'config_update',
            'Notification Channels',
            'Delivery Channels',
            "Updated notification delivery channels configuration across system alert types"
        );

        $fresh = NotificationChannel::orderBy('id')->get();
        $channelMap = [];
        foreach ($fresh as $c) {
            $channelMap[$c->alert_key] = $c->channel;
        }

        return response()->json([
            'message'    => 'Notification delivery channels have been updated successfully.',
            'channels'   => $fresh->map->toApiResponse()->values(),
            'channelMap' => $channelMap,
        ]);
    }

    /**
     * Resets all notification channels to system factory defaults.
     */
    public function reset(?Request $request = null)
    {
        $channels = NotificationChannel::all();

        DB::transaction(function () use ($channels) {
            foreach ($channels as $c) {
                $c->update(['channel' => $c->default_channel]);
            }
        });

        $this->logAudit(
            $request,
            'config_update',
            'Notification Channels',
            'Delivery Channels',
            'Reset all notification delivery channels to system defaults'
        );

        $fresh = NotificationChannel::orderBy('id')->get();
        $channelMap = [];
        foreach ($fresh as $c) {
            $channelMap[$c->alert_key] = $c->channel;
        }

        return response()->json([
            'message'    => 'Notification delivery channels have been restored to system defaults.',
            'channels'   => $fresh->map->toApiResponse()->values(),
            'channelMap' => $channelMap,
        ]);
    }

    /**
     * Inter-service lookup endpoint to check the configured channel for a given alert event.
     */
    public function getChannel(string $alertKey)
    {
        $channel = NotificationChannel::where('alert_key', $alertKey)->value('channel') ?? 'both';

        return response()->json([
            'alertKey' => $alertKey,
            'channel'  => $channel,
        ]);
    }
}
