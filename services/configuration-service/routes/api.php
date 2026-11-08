<?php

use App\Http\Controllers\EmailConfigurationController;
use App\Http\Controllers\EmailTemplateController;
use App\Http\Controllers\NotificationChannelController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Configuration Service API Routes
|--------------------------------------------------------------------------
*/

// Core configuration endpoints
$registerRoutes = function () {
    // Ephemeral RSA encryption key
    Route::get('/encryption-key', [EmailConfigurationController::class, 'getEncryptionKey']);

    // Email delivery configuration
    Route::get('/email', [EmailConfigurationController::class, 'getConfiguration']);
    Route::post('/email', [EmailConfigurationController::class, 'saveConfiguration'])->middleware('decrypt.rsa:apiKey');
    Route::put('/email', [EmailConfigurationController::class, 'updateConfiguration']);
    Route::patch('/email', [EmailConfigurationController::class, 'updateConfiguration']);
    Route::put('/email/api-key', [EmailConfigurationController::class, 'updateApiKey'])->middleware('decrypt.rsa:apiKey');
    Route::delete('/email', [EmailConfigurationController::class, 'removeConfiguration']);
    Route::post('/email/test', [EmailConfigurationController::class, 'sendTestEmail'])->middleware('decrypt.rsa:apiKey');
    Route::post('/email/dispatch', [EmailConfigurationController::class, 'dispatchEmail']);
    Route::post('/email/dispatch-event', [EmailConfigurationController::class, 'dispatchEventEmail']);

    // Email templates (event-driven configurable templates)
    Route::get('/email-templates', [EmailTemplateController::class, 'index']);
    Route::get('/email-templates/{eventKey}', [EmailTemplateController::class, 'show']);
    Route::put('/email-templates/{eventKey}', [EmailTemplateController::class, 'update']);
    Route::patch('/email-templates/{eventKey}', [EmailTemplateController::class, 'update']);
    Route::post('/email-templates/{eventKey}/toggle', [EmailTemplateController::class, 'toggle']);
    Route::post('/email-templates/{eventKey}/reset', [EmailTemplateController::class, 'reset']);
    Route::post('/email-templates/{eventKey}/test', [EmailTemplateController::class, 'sendTestTemplateEmail']);

    // Notification delivery channels (email, in_app, both)
    Route::get('/notification-channels', [NotificationChannelController::class, 'index']);
    Route::get('/notification-channels/{alertKey}', [NotificationChannelController::class, 'show']);
    Route::put('/notification-channels', [NotificationChannelController::class, 'updateAll']);
    Route::post('/notification-channels', [NotificationChannelController::class, 'updateAll']);
    Route::put('/notification-channels/{alertKey}', [NotificationChannelController::class, 'update']);
    Route::post('/notification-channels/reset', [NotificationChannelController::class, 'reset']);
    Route::get('/notification-channels/channel/{alertKey}', [NotificationChannelController::class, 'getChannel']);

    // Feedback questions (TS104 Category-scoped feedback form questions)
    Route::get('/feedback-questions', [\App\Http\Controllers\FeedbackQuestionController::class, 'index']);
    Route::get('/feedback-questions/category/{category}', [\App\Http\Controllers\FeedbackQuestionController::class, 'getByCategory']);
    Route::post('/feedback-questions', [\App\Http\Controllers\FeedbackQuestionController::class, 'store']);
    Route::put('/feedback-questions/{id}', [\App\Http\Controllers\FeedbackQuestionController::class, 'update']);
    Route::patch('/feedback-questions/{id}', [\App\Http\Controllers\FeedbackQuestionController::class, 'update']);
    Route::post('/feedback-questions/{id}/toggle', [\App\Http\Controllers\FeedbackQuestionController::class, 'toggle']);
    Route::post('/feedback-questions/reorder', [\App\Http\Controllers\FeedbackQuestionController::class, 'reorder']);
    Route::delete('/feedback-questions/{id}', [\App\Http\Controllers\FeedbackQuestionController::class, 'destroy']);
    Route::post('/feedback-questions/reset', [\App\Http\Controllers\FeedbackQuestionController::class, 'reset']);
    Route::post('/feedback-questions/seed-category', [\App\Http\Controllers\FeedbackQuestionController::class, 'seedCategory']);

    // Feedback form master status / toggle
    Route::get('/feedback-form/status', [\App\Http\Controllers\FeedbackQuestionController::class, 'getStatus']);
    Route::post('/feedback-form/status', [\App\Http\Controllers\FeedbackQuestionController::class, 'toggleStatus']);
    Route::put('/feedback-form/status', [\App\Http\Controllers\FeedbackQuestionController::class, 'toggleStatus']);
    Route::get('/feedback-config/toggle', [\App\Http\Controllers\FeedbackQuestionController::class, 'getStatus']);
    Route::post('/feedback-config/toggle', [\App\Http\Controllers\FeedbackQuestionController::class, 'toggleStatus']);
    Route::put('/feedback-config/toggle', [\App\Http\Controllers\FeedbackQuestionController::class, 'toggleStatus']);

    // Per-category feedback toggles
    Route::get('/feedback-form/category-toggles', [\App\Http\Controllers\FeedbackQuestionController::class, 'getCategoryToggles']);
    Route::post('/feedback-form/category-toggle', [\App\Http\Controllers\FeedbackQuestionController::class, 'setCategoryToggle']);
    Route::put('/feedback-form/category-toggle', [\App\Http\Controllers\FeedbackQuestionController::class, 'setCategoryToggle']);
    Route::post('/feedback-form/disable-category', [\App\Http\Controllers\FeedbackQuestionController::class, 'disableCategory']);

    // Ticket lifecycle windows & configurations
    Route::get('/ticket-configurations', [\App\Http\Controllers\TicketConfigurationController::class, 'index']);
    Route::get('/ticket-configurations/windows', [\App\Http\Controllers\TicketConfigurationController::class, 'showWindows']);
    Route::put('/ticket-configurations/windows', [\App\Http\Controllers\TicketConfigurationController::class, 'updateWindows']);
    Route::patch('/ticket-configurations/windows', [\App\Http\Controllers\TicketConfigurationController::class, 'updateWindows']);
    Route::get('/windows', [\App\Http\Controllers\TicketConfigurationController::class, 'showWindows']);
    Route::put('/windows', [\App\Http\Controllers\TicketConfigurationController::class, 'updateWindows']);
    Route::patch('/windows', [\App\Http\Controllers\TicketConfigurationController::class, 'updateWindows']);

    Route::get('/ticket-configurations/messaging', [\App\Http\Controllers\TicketConfigurationController::class, 'showMessaging']);
    Route::put('/ticket-configurations/messaging', [\App\Http\Controllers\TicketConfigurationController::class, 'updateMessaging']);
    Route::patch('/ticket-configurations/messaging', [\App\Http\Controllers\TicketConfigurationController::class, 'updateMessaging']);
    Route::get('/messaging', [\App\Http\Controllers\TicketConfigurationController::class, 'showMessaging']);
    Route::put('/messaging', [\App\Http\Controllers\TicketConfigurationController::class, 'updateMessaging']);
    Route::patch('/messaging', [\App\Http\Controllers\TicketConfigurationController::class, 'updateMessaging']);
    Route::post('/ticket-configurations/messaging/reset', function () {
        return app(\App\Http\Controllers\TicketConfigurationController::class)->reset('messaging');
    });

    Route::get('/ticket-configurations/routing', [\App\Http\Controllers\TicketConfigurationController::class, 'showRouting']);
    Route::put('/ticket-configurations/routing', [\App\Http\Controllers\TicketConfigurationController::class, 'updateRouting']);
    Route::patch('/ticket-configurations/routing', [\App\Http\Controllers\TicketConfigurationController::class, 'updateRouting']);
    Route::post('/ticket-configurations/routing/reset', function () {
        return app(\App\Http\Controllers\TicketConfigurationController::class)->reset('routing');
    });

    Route::get('/ticket-configurations/company-info', [\App\Http\Controllers\TicketConfigurationController::class, 'showCompanyInfo']);
    Route::put('/ticket-configurations/company-info', [\App\Http\Controllers\TicketConfigurationController::class, 'updateCompanyInfo']);
    Route::patch('/ticket-configurations/company-info', [\App\Http\Controllers\TicketConfigurationController::class, 'updateCompanyInfo']);
    Route::get('/ticket-configurations/company_info', [\App\Http\Controllers\TicketConfigurationController::class, 'showCompanyInfo']);
    Route::put('/ticket-configurations/company_info', [\App\Http\Controllers\TicketConfigurationController::class, 'updateCompanyInfo']);
    Route::patch('/ticket-configurations/company_info', [\App\Http\Controllers\TicketConfigurationController::class, 'updateCompanyInfo']);

    Route::get('/ticket-configurations/system-status', [\App\Http\Controllers\TicketConfigurationController::class, 'showSystemStatus']);
    Route::put('/ticket-configurations/system-status', [\App\Http\Controllers\TicketConfigurationController::class, 'updateSystemStatus']);
    Route::patch('/ticket-configurations/system-status', [\App\Http\Controllers\TicketConfigurationController::class, 'updateSystemStatus']);
    Route::get('/ticket-configurations/system_status', [\App\Http\Controllers\TicketConfigurationController::class, 'showSystemStatus']);
    Route::put('/ticket-configurations/system_status', [\App\Http\Controllers\TicketConfigurationController::class, 'updateSystemStatus']);
    Route::patch('/ticket-configurations/system_status', [\App\Http\Controllers\TicketConfigurationController::class, 'updateSystemStatus']);

    Route::get('/ticket-configurations/log-level', [\App\Http\Controllers\TicketConfigurationController::class, 'showLogLevel']);
    Route::put('/ticket-configurations/log-level', [\App\Http\Controllers\TicketConfigurationController::class, 'updateLogLevel']);
    Route::patch('/ticket-configurations/log-level', [\App\Http\Controllers\TicketConfigurationController::class, 'updateLogLevel']);
    Route::get('/ticket-configurations/log_level', [\App\Http\Controllers\TicketConfigurationController::class, 'showLogLevel']);
    Route::put('/ticket-configurations/log_level', [\App\Http\Controllers\TicketConfigurationController::class, 'updateLogLevel']);
    Route::patch('/ticket-configurations/log_level', [\App\Http\Controllers\TicketConfigurationController::class, 'updateLogLevel']);

    Route::get('/ticket-configurations/{key}', [\App\Http\Controllers\TicketConfigurationController::class, 'show']);
    Route::put('/ticket-configurations/{key}', [\App\Http\Controllers\TicketConfigurationController::class, 'update']);
    Route::patch('/ticket-configurations/{key}', [\App\Http\Controllers\TicketConfigurationController::class, 'update']);
    Route::post('/ticket-configurations/{key}/reset', [\App\Http\Controllers\TicketConfigurationController::class, 'reset']);
};

// Public RSA encryption key endpoint (no prefix)
Route::get('/encryption-key', [EmailConfigurationController::class, 'getEncryptionKey']);

// Spec 0034: config.access decides public / internal / admin per route from the verified token or
// X-Internal-Token (never from X-User-* headers). Unlisted routes fail closed to admin.
Route::middleware('config.access')->group(function () use ($registerRoutes) {
    // Direct routes (proxied with rewrite strips the prefix)
    $registerRoutes();

    // Grouped routes under /configuration/
    Route::prefix('configuration')->group($registerRoutes);

    // Grouped routes under /ticketing/configuration/
    Route::prefix('ticketing/configuration')->group($registerRoutes);
});
