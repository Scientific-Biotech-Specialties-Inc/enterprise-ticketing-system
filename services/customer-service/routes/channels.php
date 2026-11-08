<?php

use App\Models\Employee;
use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| Here you may register all of the event broadcasting channels that your
| application supports. The given channel authorization callbacks are
| used to check if an authenticated user can listen to the channel.
|
*/

Broadcast::channel('employee-status', function ($user) {
    return $user instanceof Employee && in_array($user->role, ['customer service', 'head of cs', 'head of customer service', 'cs']);
});
