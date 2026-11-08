import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  getTicketMessages,
  sendTicketMessage,
  editTicketMessage,
  getMessageEditHistory,
  deleteTicketMessage,
  pingThreadPresence,
  clearThreadPresence,
} from './messagingService';

vi.mock('@/auth/tokenStore', () => ({
  default: {
    getToken: vi.fn(() => 'mock-jwt-token'),
    clearToken: vi.fn(),
  },
}));

vi.mock('@/auth/refreshSession', () => ({
  refreshAccessToken: vi.fn(() => Promise.resolve(true)),
}));

describe('messagingService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('covers AC-1 & AC-2: sends ticket message with text and JSON attachments', async () => {
    const mockResponse = {
      data: {
        data: {
          id: 'msg-123',
          ticket_id: 101,
          message: 'Hello team',
          sender_name: 'John Doe',
          sender_role: 'Customer Support',
          attachments: [
            { id: 1, name: 'screenshot.png', url: '/storage/screenshot.png', scan_status: 'clean' },
          ],
        },
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const result = await sendTicketMessage(101, 'Hello team', [
      { id: 1, name: 'screenshot.png', url: '/storage/screenshot.png' },
    ]);

    expect(requestSpy).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.id).toBe('msg-123');
    expect(result.sender_role).toBe('Customer Support');
    expect(result.attachments).toHaveLength(1);
  });

  it('covers AC-1 & AC-2: sends multipart FormData when File objects are attached', async () => {
    const fakeFile = new File(['dummy binary content'], 'logs.txt', { type: 'text/plain' });
    const mockResponse = {
      data: {
        data: {
          id: 'msg-456',
          ticket_id: 102,
          message: 'Here are the diagnostic logs',
          attachments: [{ name: 'logs.txt', file_size: 20, scan_status: 'clean' }],
        },
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const result = await sendTicketMessage(102, 'Here are the diagnostic logs', [fakeFile]);

    expect(requestSpy).toHaveBeenCalled();
    const config = requestSpy.mock.calls[0][0];
    expect(config.data instanceof FormData).toBe(true);
    expect(result.id).toBe('msg-456');
  });

  it('covers AC-19: edits an existing message with updated text', async () => {
    const mockResponse = {
      data: {
        data: {
          id: 'msg-123',
          ticket_id: 101,
          message: 'Corrected typo here',
          is_edited: true,
          edited: true,
          edited_at: '2026-10-22T19:00:00Z',
          edit_history: [{ version: 1, message: 'Typo here' }],
        },
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const result = await editTicketMessage(101, 'msg-123', 'Corrected typo here');

    expect(requestSpy).toHaveBeenCalled();
    expect(result.message).toBe('Corrected typo here');
    expect(result.is_edited).toBe(true);
    expect(result.edit_history).toHaveLength(1);
  });

  it('covers AC-17 & AC-24: retrieves message edit history for audit traceability', async () => {
    const mockResponse = {
      data: {
        message_id: 'msg-123',
        ticket_id: 101,
        original_sent_at: '2026-10-22T18:00:00Z',
        current_content: 'Latest revision',
        edit_history: [
          { version: 1, message: 'Original draft', edited_at: '2026-10-22T18:10:00Z', editor_name: 'John Doe' },
        ],
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const history = await getMessageEditHistory(101, 'msg-123');

    expect(requestSpy).toHaveBeenCalled();
    expect(history.message_id).toBe('msg-123');
    expect(history.edit_history).toHaveLength(1);
    expect(history.edit_history[0].editor_name).toBe('John Doe');
  });

  it('covers AC-8: retrieves ticket messages with normalized id and _id fields', async () => {
    const mockResponse = {
      data: {
        messages: [
          { _id: 'mongo-id-1', ticket_id: 101, message: 'First', sender_role: 'Customer', created_at: '2026-10-22T10:00:00Z' },
          { id: 'mongo-id-2', ticket_id: 101, message: 'Second', sender_role: 'Customer Support', created_at: '2026-10-22T10:05:00Z' },
        ],
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const messages = await getTicketMessages(101);

    expect(requestSpy).toHaveBeenCalled();
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('mongo-id-1');
    expect(messages[1].id).toBe('mongo-id-2');
  });

  it('deletes ticket message for current user', async () => {
    const mockResponse = {
      data: {
        message: 'Message deleted for you successfully',
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const result = await deleteTicketMessage(101, 'msg-123');

    expect(requestSpy).toHaveBeenCalled();
    expect(result.message).toBe('Message deleted for you successfully');
  });

  it('covers AC-4: pings thread presence with ticket id successfully', async () => {
    const mockResponse = {
      data: {
        status: 'ok',
        presence_key: 'ticket:presence:101:client:1',
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const result = await pingThreadPresence(101);

    expect(requestSpy).toHaveBeenCalled();
    expect(result).toEqual(mockResponse.data);
  });

  it('covers AC-4: safely handles error when pinging thread presence fails', async () => {
    vi.spyOn(axios.Axios.prototype, 'request').mockRejectedValue(new Error('Network timeout'));

    const result = await pingThreadPresence(101);

    expect(result).toBeNull();
  });

  it('covers AC-4: clears thread presence when leaving ticket thread', async () => {
    const mockResponse = {
      data: {
        status: 'cleared',
      },
    };

    const requestSpy = vi.spyOn(axios.Axios.prototype, 'request').mockResolvedValue(mockResponse);

    const result = await clearThreadPresence(101);

    expect(requestSpy).toHaveBeenCalled();
    expect(result).toEqual(mockResponse.data);
  });

  it('covers AC-4: safely handles error when clearing thread presence fails', async () => {
    vi.spyOn(axios.Axios.prototype, 'request').mockRejectedValue(new Error('Network timeout'));

    const result = await clearThreadPresence(101);

    expect(result).toBeNull();
  });
});
