<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AiChatController;
use App\Http\Controllers\KbArticleController;

/*
|--------------------------------------------------------------------------
| API Routes for AI-service
|--------------------------------------------------------------------------
*/

Route::middleware('auth:api')->get('/user', function (Request $request) {
    return $request->user();
});

// AI Chat & Support Triage Routes
// Spec 0034: a verified token or a valid X-Internal-Token is required; nothing else reaches the controller.
Route::middleware('auth.token_or_internal')->group(function () {
    Route::post('/chat', [AiChatController::class, 'chat']);
    Route::post('/classify-department', [AiChatController::class, 'classifyDepartment']);
    Route::post('/classify-category', [AiChatController::class, 'classifyCategory']);
    Route::get('/conversations', [AiChatController::class, 'conversations']);
    Route::get('/conversations/{id}', [AiChatController::class, 'showConversation']);
    Route::get('/conversations/{id}/escalate-handoff', [AiChatController::class, 'escalateHandoff']);
    Route::get('/escalate-handoff/{id}', [AiChatController::class, 'escalateHandoff']);
    Route::delete('/conversations/{id}', [AiChatController::class, 'deleteConversation']);
    Route::delete('/conversations/{id}/messages/{messageId}', [AiChatController::class, 'deleteMessage']);
    Route::post('/tickets', [AiChatController::class, 'markTicketCreated']);
});

// Knowledge Base Article & RAG Lifecycle Routes
$registerKbRoutes = function () {
    // Reads are unchanged by spec 0036 (restricting them to staff is a listed follow up).
    Route::get('/articles', [KbArticleController::class, 'index']);
    Route::get('/articles/categories', [KbArticleController::class, 'categories']);
    Route::get('/articles/template-csv', [KbArticleController::class, 'downloadTemplateCsv']);
    Route::get('/articles/{id}', [KbArticleController::class, 'show']);
    Route::get('/articles/{id}/file', [KbArticleController::class, 'downloadFile']);

    // Spec 0036 (AC-11): every KB write needs a verified token or a valid X-Internal-Token.
    // The controller then requires the verified user to be a superadmin (403 otherwise).
    Route::middleware('auth.token_or_internal')->group(function () {
        Route::post('/articles/scan-file', [KbArticleController::class, 'scanFile']);
        Route::post('/articles/import-csv', [KbArticleController::class, 'importCsv']);
        Route::post('/articles', [KbArticleController::class, 'store']);
        Route::put('/articles/{id}', [KbArticleController::class, 'update']);
        Route::patch('/articles/{id}', [KbArticleController::class, 'update']);
        Route::post('/articles/{id}/publish', [KbArticleController::class, 'publish']);
        Route::post('/articles/{id}/archive', [KbArticleController::class, 'archive']);
        Route::post('/articles/{id}/reindex', [KbArticleController::class, 'reindex']);
        Route::post('/articles/{id}/replace-file', [KbArticleController::class, 'replaceFile']);
        Route::delete('/articles/{id}', [KbArticleController::class, 'destroy']);
    });
};

$registerKbRoutes();

// Also alias under /kb for direct gateway routing
Route::prefix('kb')->group($registerKbRoutes);
