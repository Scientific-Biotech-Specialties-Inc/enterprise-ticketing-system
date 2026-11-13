<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\ClientCredential;
use App\Mail\CustomerProvisionedMail;
use App\Services\Mail\ConfigServiceMailer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class ProvisionController extends Controller
{
    public function provision(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'client_name'    => 'required|string|max:255',
            'email'          => 'required|email|max:255',
            'address'        => 'required|string|max:500',
            'contact_number' => 'required|string|max:50',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation failed.',
                'errors'  => $validator->errors()
            ], 422);
        }

        $validated = $validator->validated();

        // Check if customer exists by email
        $client = Client::where('email', $validated['email'])->first();

        if ($client) {
            return response()->json([
                'id'      => $client->id,
                'message' => 'Customer already exists.',
                'status'  => 'exists'
            ], 200);
        }

        // Generate a temporary password
        $temporaryPassword = Str::random(12);

        DB::beginTransaction();
        try {
            $client = Client::create([
                'client_name'    => $validated['client_name'],
                'email'          => $validated['email'],
                'address'        => $validated['address'],
                'contact_number' => $validated['contact_number'],
                'status'         => true,
            ]);

            ClientCredential::create([
                'client_id'          => $client->id,
                'password_hash'      => Hash::make($temporaryPassword),
                'failed_login_count' => 0,
                'locked_until'       => null,
                'last_login_at'      => null,
                'password_change_at' => now(), // OTP first-login flow is disabled; stamp it immediately
            ]);

            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Customer provisioning failed: ' . $e->getMessage());
            return response()->json([
                'message' => 'Failed to provision customer account.',
                'error'   => $e->getMessage()
            ], 500);
        }

        // Send Email notification
        try {
            // Spec 0040: configuration-service (Brevo API) first, Brevo SMTP relay as backup.
            app(ConfigServiceMailer::class)->send(
                $client->email,
                new CustomerProvisionedMail($client, $temporaryPassword),
                null,
                ConfigServiceMailer::CATEGORY_SECURITY
            );
        } catch (\Throwable $e) {
            Log::error('Failed to send provision email: ' . $e->getMessage());
        }

        return response()->json([
            'id'      => $client->id,
            'message' => 'Customer provisioned successfully.',
            'status'  => 'created'
        ], 201);
    }
}
