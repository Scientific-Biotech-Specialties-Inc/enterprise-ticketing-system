<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProvisionController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

Route::post('/customers/provision', [ProvisionController::class, 'provision']);

Route::get('/encryption-key', [AuthController::class, 'getEncryptionKey']);
Route::post('/login', [AuthController::class, 'login'])->middleware(['throttle:ip_auth', 'decrypt.rsa:password']);
Route::post('/auth/refresh', [AuthController::class, 'refresh'])->middleware('throttle:ip_auth');
Route::post('/logout', [AuthController::class, 'logout']);
Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware(['throttle:ip_auth', 'throttle:otp_request']);
Route::post('/forgot-password/verify', [AuthController::class, 'verifyForgotPasswordOtp'])->middleware(['throttle:ip_auth', 'throttle:otp_request']);
Route::post('/reset-password', [AuthController::class, 'resetForgotPassword'])->middleware(['throttle:ip_auth', 'decrypt.rsa:password,password_confirmation']);


Route::middleware('auth.subsystem')->group(function () {
    Route::post('/heartbeat', [AuthController::class, 'heartbeat']);
    Route::post('/change-password', [AuthController::class, 'changePassword'])->middleware(['throttle:otp_request', 'decrypt.rsa:current_password,new_password,new_password_confirmation']);
    Route::get('/profile', [AuthController::class, 'getProfile']);
    Route::put('/profile', [AuthController::class, 'updateProfile']);
    Route::get('/notification-preferences', [AuthController::class, 'getNotificationPreferences']);
    Route::put('/notification-preferences', [AuthController::class, 'updateNotificationPreferences']);
    Route::post('/first-login/resend-otp', [AuthController::class, 'resendFirstLoginOtp'])->middleware('throttle:otp_request');
    Route::post('/first-login/verify-otp', [AuthController::class, 'verifyFirstLoginOtp'])->middleware('throttle:otp_request');
    Route::get('/me', [AuthController::class, 'me']);
    Route::get('/employee-statuses', [AuthController::class, 'employeeStatuses']);
    Route::get('/user', function (Request $request) {
        return $request->user();
    });
});

Route::get('/sanctum/csrf-cookie', function () {
    return response()->noContent();
});
