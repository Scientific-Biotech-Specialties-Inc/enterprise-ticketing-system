import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TicketCreation from './TicketCreation';
import * as ticketService from '@/services/ticketService';
import * as configurationService from '@/services/configurationService';

vi.mock('@/services/ticketService', () => ({
  getTicketFormOptions: vi.fn(),
  createTicket: vi.fn(),
  getCustomerTickets: vi.fn(),
  saveTicketDraft: vi.fn(),
  getTicketDraft: vi.fn(),
  uploadAttachments: vi.fn(),
  getEscalateHandoff: vi.fn(),
  classifyDepartment: vi.fn(),
}));

vi.mock('@/services/configurationService', () => ({
  getSystemStatus: vi.fn(),
  getFileLimitsConfig: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { client_ID: 7, name: 'Customer One', role: 'customer' } }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/components/NotificationModal', () => ({ default: () => null }));
vi.mock('@/components/TitleCasingModal', () => ({ default: () => null }));
vi.mock('@/components/AIDepartmentModal', () => ({ default: () => null }));

const MB = 1024 * 1024;

/** Build a File whose reported size is exactly `bytes`, without allocating that much memory. */
function makeFile(name, bytes) {
  const file = new File(['x'], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

function pickFiles(files) {
  const input = document.getElementById('ticket-creation-file-upload');
  fireEvent.change(input, { target: { files } });
}

async function renderPage({ limits, limitsError } = {}) {
  if (limitsError) {
    configurationService.getFileLimitsConfig.mockRejectedValue(limitsError);
  } else {
    configurationService.getFileLimitsConfig.mockResolvedValue(limits);
  }
  render(
    <MemoryRouter>
      <TicketCreation />
    </MemoryRouter>
  );
  // Wait until the page has finished loading its form options and limits request.
  await waitFor(() => expect(configurationService.getFileLimitsConfig).toHaveBeenCalled());
  await waitFor(() => expect(ticketService.getTicketFormOptions).toHaveBeenCalled());
}

describe('TicketCreation: customer uploads honor the superadmin file size limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    ticketService.getTicketFormOptions.mockResolvedValue({
      equipment_options: [],
      category_options: [],
      machines: [],
      problem_categories: [],
      ticket_priorities: [{ priority_ID: 1, priority_name: 'Low' }],
    });
    ticketService.getCustomerTickets.mockResolvedValue([]);
    ticketService.uploadAttachments.mockResolvedValue([{ id: 99, url: '/storage/x' }]);
    configurationService.getSystemStatus.mockResolvedValue('Operational');
  });

  describe('limits set by the superadmin', () => {
    it('shows the live size limit and file count on the upload box', async () => {
      await renderPage({
        limits: { maxFileSizeMB: 5, maxFileCount: 3, allowedFileTypes: ['pdf', 'png'] },
      });

      expect(await screen.findByText(/max 5MB per file, 3 files/i)).toBeInTheDocument();
      expect(screen.getByText(/PDF, PNG/)).toBeInTheDocument();
    });

    it('rejects a file bigger than the superadmin limit and never sends it to the server', async () => {
      await renderPage({ limits: { maxFileSizeMB: 5, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/max 5MB per file/i);

      pickFiles([makeFile('too-big.pdf', 5 * MB + 1)]);

      expect(await screen.findByText(/"too-big.pdf" exceeds the maximum limit of 5MB/i)).toBeInTheDocument();
      expect(ticketService.uploadAttachments).not.toHaveBeenCalled();
      expect(screen.queryByText('too-big.pdf')).not.toBeInTheDocument();
    });

    it('accepts a file that is exactly at the limit', async () => {
      await renderPage({ limits: { maxFileSizeMB: 5, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/max 5MB per file/i);

      pickFiles([makeFile('exact.pdf', 5 * MB)]);

      await waitFor(() => expect(ticketService.uploadAttachments).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/exceeds the maximum limit/i)).not.toBeInTheDocument();
    });

    it('rejects a 10MB file when the superadmin lowered the limit below the old 15MB default', async () => {
      await renderPage({ limits: { maxFileSizeMB: 2, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/max 2MB per file/i);

      pickFiles([makeFile('ten-mb.pdf', 10 * MB)]);

      expect(await screen.findByText(/exceeds the maximum limit of 2MB/i)).toBeInTheDocument();
      expect(ticketService.uploadAttachments).not.toHaveBeenCalled();
    });

    it('allows a 20MB file when the superadmin raised the limit above the old default', async () => {
      await renderPage({ limits: { maxFileSizeMB: 25, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/max 25MB per file/i);

      pickFiles([makeFile('twenty-mb.pdf', 20 * MB)]);

      await waitFor(() => expect(ticketService.uploadAttachments).toHaveBeenCalledTimes(1));
    });

    it('supports a fractional limit such as 0.5MB', async () => {
      await renderPage({ limits: { maxFileSizeMB: 0.5, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/max 0.5MB per file/i);

      pickFiles([makeFile('one-mb.pdf', 1 * MB)]);

      expect(await screen.findByText(/exceeds the maximum limit of 0.5MB/i)).toBeInTheDocument();
      expect(ticketService.uploadAttachments).not.toHaveBeenCalled();
    });

    it('stops the whole selection when one file in a batch is over the limit', async () => {
      await renderPage({ limits: { maxFileSizeMB: 5, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/max 5MB per file/i);

      pickFiles([makeFile('ok.pdf', 1 * MB), makeFile('huge.pdf', 6 * MB)]);

      expect(await screen.findByText(/"huge.pdf" exceeds the maximum limit of 5MB/i)).toBeInTheDocument();
      expect(ticketService.uploadAttachments).not.toHaveBeenCalled();
    });

    it('blocks more files than the superadmin allows', async () => {
      await renderPage({ limits: { maxFileSizeMB: 5, maxFileCount: 2, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/2 files/i);

      pickFiles([makeFile('a.pdf', MB), makeFile('b.pdf', MB), makeFile('c.pdf', MB)]);

      expect(await screen.findByText(/maximum of 2 files/i)).toBeInTheDocument();
      expect(ticketService.uploadAttachments).not.toHaveBeenCalled();
    });

    it('blocks file types the superadmin has not allowed', async () => {
      await renderPage({ limits: { maxFileSizeMB: 5, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      await screen.findByText(/max 5MB per file/i);

      pickFiles([makeFile('photo.png', MB)]);

      expect(await screen.findByText(/Invalid file type "photo.png"/i)).toBeInTheDocument();
      expect(ticketService.uploadAttachments).not.toHaveBeenCalled();
    });
  });

  describe('when the live limits cannot be used', () => {
    it('falls back to the 15MB default when the config request fails', async () => {
      await renderPage({ limitsError: new Error('config service down') });

      expect(screen.getByText(/max 15MB per file, 5 files/i)).toBeInTheDocument();

      pickFiles([makeFile('over-default.pdf', 16 * MB)]);
      expect(await screen.findByText(/exceeds the maximum limit of 15MB/i)).toBeInTheDocument();
      expect(ticketService.uploadAttachments).not.toHaveBeenCalled();
    });

    it('ignores a zero or non numeric size and keeps the default limit', async () => {
      await renderPage({ limits: { maxFileSizeMB: 0, maxFileCount: 'abc', allowedFileTypes: [] } });

      expect(screen.getByText(/max 15MB per file, 5 files/i)).toBeInTheDocument();
      expect(screen.getByText(/PDF, PNG, DOCX, DOC, JPG, JPEG/)).toBeInTheDocument();
    });
  });

  describe('when the server is the one that rejects the file', () => {
    it('shows the server message, removes the file, and never marks it as clean', async () => {
      // Client fell back to 15MB, but the real superadmin limit on the server is lower.
      await renderPage({ limitsError: new Error('config service down') });

      ticketService.uploadAttachments.mockRejectedValue({
        response: {
          status: 422,
          data: {
            message: "File 'report.pdf' exceeds the maximum allowed size of 5 MB.",
            errors: { attachments: ["File 'report.pdf' exceeds the limit of 5 MB."] },
          },
        },
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      pickFiles([makeFile('report.pdf', 10 * MB)]);

      expect(await screen.findByText("File 'report.pdf' exceeds the limit of 5 MB.")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText('report.pdf')).not.toBeInTheDocument());
    });

    it('falls back to a plain message when the server gives no detail', async () => {
      await renderPage({ limits: { maxFileSizeMB: 15, maxFileCount: 5, allowedFileTypes: ['pdf'] } });
      ticketService.uploadAttachments.mockRejectedValue(new Error('Network Error'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      pickFiles([makeFile('lost.pdf', MB)]);

      expect(
        await screen.findByText(/This file could not be uploaded\. Please remove it and try again\./i)
      ).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText('lost.pdf')).not.toBeInTheDocument());
    });
  });
});
