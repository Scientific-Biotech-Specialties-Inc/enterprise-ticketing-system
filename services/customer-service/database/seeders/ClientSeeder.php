<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Client;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class ClientSeeder extends Seeder
{
    public function run(): void
    {
        $customers = [
            [
                'client_name' => 'Customer Example',
                'address' => 'QC',
                'contact_number' => '09123456780',
                'email' => 'customer@example.com',
            ],
            [
                'client_name' => 'Customer One',
                'address' => 'QC',
                'contact_number' => '09123456781',
                'email' => 'customer@gmail.com',
            ],
            [
                'client_name' => 'Slosinada User',
                'address' => 'QC',
                'contact_number' => '09123456782',
                'email' => 'slosinada@gmail.com',
            ],
        ];

        foreach ($customers as $customerData) {
            $client = Client::updateOrCreate(
                ['email' => $customerData['email']],
                [
                    'client_name' => $customerData['client_name'],
                    'address' => $customerData['address'],
                    'contact_number' => $customerData['contact_number'],
                    'status' => true,
                ]
            );

            DB::table('clients_credentials')->updateOrInsert(
                ['client_id' => $client->id],
                [
                    'password_hash' => Hash::make('password'),
                    'failed_login_count' => 0,
                    'locked_until' => null,
                    'last_login_at' => null,
                    'password_change_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]
            );
        }
    }
}