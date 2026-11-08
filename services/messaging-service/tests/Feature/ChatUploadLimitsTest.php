<?php

namespace Tests\Feature;

use App\Http\Controllers\MessageController;
use App\Models\Client;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * Regression: messaging-service ran with PHP's default limits (8M per request, 2M per file).
 * A chat message with a larger file lost its whole body, so the server answered
 * "Please provide either a message or an attachment" even though both were sent.
 */
class ChatUploadLimitsTest extends TestCase
{
    /** The running PHP must accept at least the superadmin's default 15 MB file, plus text. */
    public function test_php_upload_limits_allow_chat_files(): void
    {
        $fifteenMb = 15 * 1024 * 1024;
        $this->assertGreaterThanOrEqual($fifteenMb, MessageController::iniSizeToBytes((string) ini_get('upload_max_filesize')),
            'upload_max_filesize is too small; is services/messaging-service/uploads.ini installed into conf.d?');
        $this->assertGreaterThan($fifteenMb, MessageController::iniSizeToBytes((string) ini_get('post_max_size')),
            'post_max_size is too small; is services/messaging-service/uploads.ini installed into conf.d?');
    }

    public function test_the_shipped_uploads_ini_has_the_raised_limits(): void
    {
        $ini = parse_ini_file(base_path('uploads.ini'));
        $this->assertSame('50M', $ini['upload_max_filesize']);
        $this->assertSame('50M', $ini['post_max_size']);
    }

    public function test_ini_size_parsing(): void
    {
        $this->assertSame(8 * 1024 * 1024, MessageController::iniSizeToBytes('8M'));
        $this->assertSame(2048, MessageController::iniSizeToBytes('2K'));
        $this->assertSame(1024 * 1024 * 1024, MessageController::iniSizeToBytes('1G'));
        $this->assertSame(500, MessageController::iniSizeToBytes('500'));
    }

    public function test_a_body_over_post_max_size_is_reported_as_too_large(): void
    {
        $limit = MessageController::iniSizeToBytes((string) ini_get('post_max_size'));

        $over = Request::create('/api/tickets/1/messages', 'POST', [], [], [], ['CONTENT_LENGTH' => (string) ($limit + 1)]);
        $under = Request::create('/api/tickets/1/messages', 'POST', [], [], [], ['CONTENT_LENGTH' => '1024']);

        $this->assertTrue(MessageController::bodyExceededPostLimit($over));
        $this->assertFalse(MessageController::bodyExceededPostLimit($under));
    }

    public function test_a_file_php_rejected_gets_a_clear_error_instead_of_vanishing(): void
    {
        $client = new Client();
        $client->forceFill(['id' => 990038, 'client_name' => 'Upload Limit Customer']);
        $client->exists = true;

        // error 1 = UPLOAD_ERR_INI_SIZE (the file was over upload_max_filesize)
        $rejected = new UploadedFile(__FILE__, 'scan.pdf', 'application/pdf', UPLOAD_ERR_INI_SIZE, true);

        $response = $this->actingAs($client, 'api')->post('/api/tickets/990038001/messages', [
            'message' => 'see attached',
            'attachments' => [$rejected],
        ], ['Accept' => 'application/json']);

        $response->assertStatus(422)->assertJsonPath('code', 'ATTACHMENT_UPLOAD_FAILED');
    }
}
