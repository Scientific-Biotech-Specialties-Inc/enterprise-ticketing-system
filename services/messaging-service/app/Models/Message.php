<?php

namespace App\Models;

use MongoDB\Laravel\Eloquent\Model;

class Message extends Model
{
    protected $connection = 'mongodb';
    protected $collection = 'messages';

    protected $fillable = [
        'ticket_id',
        'sender_id',
        'sender_name',
        'sender_type', // 'customer', 'employee', 'cs'
        'sender_role', // Snapshot of sender role at time of send (e.g. 'Customer', 'Customer Support', 'Service Engineer')
        'message',
        'attachments', // Array of attachment metadata: [{ id, name, url, file_path, file_size, file_type, scan_status }]
        'edit_history',
        'is_edited',
        'edited',
        'edited_at',
        'deleted_by',
        'is_internal',
        'exclude_ai',
    ];

    /**
     * The "booted" method of the model.
     */
    protected static function booted()
    {
        try {
            self::raw(function ($collection) {
                $collection->createIndex(['ticket_id' => 1]);
                $collection->createIndex(['created_at' => -1]);
            });
        } catch (\Exception $e) {
            // Ignore index creation errors to prevent blocking runtime if connection issues occur during boot
        }
    }
}
