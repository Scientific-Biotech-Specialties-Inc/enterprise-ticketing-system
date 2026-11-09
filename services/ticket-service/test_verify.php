<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

$key1 = trim(file_get_contents(storage_path('auth-module-public.key')));

echo "Key1 len: " . strlen($key1) . "\n";

$token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIwMWExNTllOC03ZDRmLTczNjMtODQ0Ny0zNGJiODdjODJlMzgiLCJqdGkiOiI0MWVjZjJlN2MxNDcwYzQ1NDFjMDA1NzUyODhlNDY1MDc1YTlkMzlkOGVhMTdlNDA4NjQwZWRjYTdmNzI2ZDkzZjFkYTE4NTc4M2E0N2VlNSIsImlhdCI6MTc5NDE1NDEyNy42Mjg3MiwibmJmIjoxNzk0MTU0MTI3LjYyODcyNCwiZXhwIjoxODI1NjkwMTI3LjYxMTE5Mywic3ViIjoiMjE5Iiwic2NvcGVzIjpbXSwicm9sZSI6IlN1cGVyIEFkbWluIiwiZGVwYXJ0bWVudCI6IklUIiwiZW1haWwiOiJzdXBlcmFkbWluQGV4YW1wbGUuY29tIiwiZmlyc3RfbmFtZSI6IlN1cGVyIiwibGFzdF9uYW1lIjoiQWRtaW4ifQ.ZUXp10o_EAZEjuClQLMvHhS3SB8SbTPF_jBeEvzRBrjhejWuwMbqMPNeD6xnX5llyjaPf0RbZZiOGGwlY9VleQUZonc8SHuh6xOOylySyfiJOyWl5LBN9tgumHo_3HGRfRKd-A4SKn4PWP5eiqBb5oCaQISxyJf0DxVf0VITvlOvCIP5uLkMHrOphIatAmgnFDYT1g529vBtFdTdlCk7GCoZf_ON_bUvVEimOjkN9PUwJ0b5yATkwMX7qmuvmVI8iaCcihscbcb95gh6gNKB7gyUkJbTo5xQ8jl3ZQ4wrv3u7rtG2DRYU-ZrlIy4_OAEbrMqe5mIH7yw7fM90dF7AMnG91hPgNgYTugxnDjmSg6tiGF0jNRMNT8kH2GeSi3GlQ3GuMfCO1sYS3On9l_4RxxTYpYHaM1dOLUb-XEiYejoHZcGoK-CGhZJdMZfSnPlNx16f59AP87J0MDCaTQkDt3LSYP0C9WhW3L2qs38x8lQnQ0_lwo6vzzv4CgsysIIF1PN0vaUO6CO2P5xEQ98BcoSi81Bw9R7iY-rUyzBCdBDcFHD8nHDiANhKEsjH9mAOIrzciggzxmg_sJs3wAVuxsRkfe6OVkyvnPEZVcAnIkzWbEm-G9yZOimgKsN_hlxXPR4ebjBsw5_3qKygXRosAFsk0qU3UgZ16ER-1SPUrY";

$parts = explode('.', $token);
$data = $parts[0] . '.' . $parts[1];
$sig = base64_decode(strtr($parts[2], '-_', '+/'));

$pubResource = openssl_pkey_get_public($key1);
if (!$pubResource) {
    echo "Failed to load public key resource!\n";
} else {
    $v = openssl_verify($data, $sig, $pubResource, OPENSSL_ALGO_SHA256);
    echo "Verification with Key1: $v\n";
}
