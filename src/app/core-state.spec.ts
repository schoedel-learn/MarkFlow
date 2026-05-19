import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ConverterService } from './converter.service';
import { CoreStateService } from './core-state';
import { APPROVED_USER_LOOKUP, EntitlementService } from './entitlement.service';
import {
  APPROVED_PDF_SYNC_MAX_BYTES,
  buildPublicPdfLimitMessage,
  PUBLIC_PDF_MAX_BYTES,
  PUBLIC_PDF_MAX_PAGES,
} from './pdf-access-policy';
import { ServerPdfService } from './server-pdf.service';

describe('CoreStateService', () => {
  let service: CoreStateService;
  let converter: Pick<ConverterService, 'inspectPdf' | 'pdfToMd' | 'docxToMd'>;
  let entitlement: Pick<EntitlementService, 'resolveMode'>;
  let serverPdf: Pick<ServerPdfService, 'convertApprovedPdfSync' | 'createApprovedPdfJob' | 'pollApprovedPdfJob'>;

  beforeEach(() => {
    converter = {
      inspectPdf: vi.fn(),
      pdfToMd: vi.fn(),
      docxToMd: vi.fn()
    };
    entitlement = {
      resolveMode: vi.fn()
    };
    serverPdf = {
      convertApprovedPdfSync: vi.fn(),
      createApprovedPdfJob: vi.fn(),
      pollApprovedPdfJob: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        CoreStateService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ConverterService, useValue: converter },
        { provide: EntitlementService, useValue: entitlement },
        { provide: ServerPdfService, useValue: serverPdf }
      ]
    });

    service = TestBed.inject(CoreStateService);
    service.user.set({ uid: 'u1', email: 'public@example.com' } as any);
    service.geminiKey.set('test-key');
    vi.spyOn(service as any, 'downloadFile').mockImplementation(() => {});
    vi.spyOn(service, 'incrementConversionCount').mockResolvedValue();
    vi.spyOn(service as any, 'checkDailyConversionLimit').mockResolvedValue(true);
  });

  it('blocks oversized public PDF conversion', async () => {
    vi.mocked(entitlement.resolveMode).mockResolvedValue('public_byok');
    vi.mocked(converter.inspectPdf).mockResolvedValue({ pageCount: PUBLIC_PDF_MAX_PAGES + 5, sizeBytes: 1024 });
    service.selectedFile.set(new File(['pdf'], 'large.pdf', { type: 'application/pdf' }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    expect(service.entitlementMode()).toBe('public_byok');
    expect(service.error()).toBe(buildPublicPdfLimitMessage({
      pageCount: PUBLIC_PDF_MAX_PAGES + 5,
      sizeBytes: 1024
    }));
    expect(converter.pdfToMd).not.toHaveBeenCalled();
  });

  it('short-circuits oversized public PDFs before inspection', async () => {
    vi.mocked(entitlement.resolveMode).mockResolvedValue('public_byok');
    service.selectedFile.set(new File([new Uint8Array(PUBLIC_PDF_MAX_BYTES + 1)], 'too-large.pdf', { type: 'application/pdf' }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    expect(service.entitlementMode()).toBe('public_byok');
    expect(service.error()).toBe(buildPublicPdfLimitMessage({
      sizeBytes: PUBLIC_PDF_MAX_BYTES + 1
    }));
    expect(converter.inspectPdf).not.toHaveBeenCalled();
    expect(converter.pdfToMd).not.toHaveBeenCalled();
  });

  it('lets approved users bypass the public PDF block', async () => {
    vi.mocked(entitlement.resolveMode).mockResolvedValue('approved_server');
    vi.mocked(converter.inspectPdf).mockResolvedValue({ pageCount: 2, sizeBytes: 1024 });
    vi.mocked(serverPdf.convertApprovedPdfSync).mockResolvedValue('# converted');
    service.selectedFile.set(new File(['pdf'], 'large.pdf', { type: 'application/pdf' }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    expect(service.entitlementMode()).toBe('approved_server');
    expect(converter.inspectPdf).toHaveBeenCalledTimes(1);
    expect(converter.pdfToMd).not.toHaveBeenCalled();
    expect(serverPdf.convertApprovedPdfSync).toHaveBeenCalledTimes(1);
    expect(serverPdf.createApprovedPdfJob).not.toHaveBeenCalled();
  });

  it('lets approved users convert PDFs without a Gemini key', async () => {
    vi.mocked(entitlement.resolveMode).mockResolvedValue('approved_server');
    vi.mocked(converter.inspectPdf).mockResolvedValue({ pageCount: 2, sizeBytes: 1024 });
    vi.mocked(serverPdf.convertApprovedPdfSync).mockResolvedValue('# converted');
    service.geminiKey.set('');
    service.selectedFile.set(new File(['pdf'], 'approved.pdf', { type: 'application/pdf' }));
    const showProfileMenuFn = vi.fn();

    await service.convertToMarkdown({ showProfileMenuFn });

    expect(service.entitlementMode()).toBe('approved_server');
    expect(showProfileMenuFn).not.toHaveBeenCalled();
    expect(service.error()).toBeNull();
    expect(converter.pdfToMd).not.toHaveBeenCalled();
    expect(serverPdf.convertApprovedPdfSync).toHaveBeenCalledWith(expect.any(File), 'auto');
    expect(serverPdf.createApprovedPdfJob).not.toHaveBeenCalled();
  });

  it('queues large approved PDFs as background jobs and starts polling', async () => {
    vi.mocked(entitlement.resolveMode).mockResolvedValue('approved_server');
    vi.mocked(serverPdf.createApprovedPdfJob).mockResolvedValue({
      jobId: 'job-123',
      status: 'queued',
      storageInputPath: 'pdf-inputs/u1/job-123/source.pdf'
    } as any);
    vi.mocked(serverPdf.pollApprovedPdfJob).mockResolvedValue({
      jobId: 'job-123',
      status: 'queued'
    } as any);
    service.selectedFile.set(new File([new Uint8Array(APPROVED_PDF_SYNC_MAX_BYTES + 1)], 'large-approved.pdf', { type: 'application/pdf' }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });
    await Promise.resolve();

    expect(serverPdf.createApprovedPdfJob).toHaveBeenCalledTimes(1);
    expect(serverPdf.pollApprovedPdfJob).toHaveBeenCalledWith('job-123');
    expect(serverPdf.convertApprovedPdfSync).not.toHaveBeenCalled();
    expect(service.approvedPdfJob()).toEqual(expect.objectContaining({ jobId: 'job-123', status: 'queued' }));
  });

  it('does not block non-PDF markdown conversions on entitlement lookup', async () => {
    vi.mocked(entitlement.resolveMode).mockRejectedValue(new Error('lookup failed'));
    vi.mocked(converter.docxToMd).mockResolvedValue('# converted');
    service.selectedFile.set(new File(['docx'], 'notes.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    expect(service.error()).toBeNull();
    expect(converter.docxToMd).toHaveBeenCalledWith(expect.any(File), 'auto', 'test-key');
    expect(entitlement.resolveMode).not.toHaveBeenCalled();
  });

  it('refreshes PDF entitlement on each access check', async () => {
    vi.mocked(entitlement.resolveMode)
      .mockResolvedValueOnce('public_byok')
      .mockResolvedValueOnce('approved_server');
    vi.mocked(converter.inspectPdf).mockResolvedValue({ pageCount: 1, sizeBytes: 1024 });
    vi.mocked(converter.pdfToMd).mockResolvedValue('# converted');
    vi.mocked(serverPdf.convertApprovedPdfSync).mockResolvedValue('# converted');
    service.selectedFile.set(new File(['pdf'], 'refresh.pdf', { type: 'application/pdf' }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    service.error.set(null);
    service.geminiKey.set('');

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    expect(entitlement.resolveMode).toHaveBeenCalledTimes(2);
    expect(service.entitlementMode()).toBe('approved_server');
    expect(service.error()).toBeNull();
    expect(converter.pdfToMd).toHaveBeenCalledTimes(1);
    expect(serverPdf.convertApprovedPdfSync).toHaveBeenCalledTimes(1);
  });

  it('falls back to public_byok when PDF entitlement refresh fails', async () => {
    vi.mocked(entitlement.resolveMode).mockRejectedValue(new Error('lookup failed'));
    vi.mocked(converter.inspectPdf).mockResolvedValue({ pageCount: 1, sizeBytes: 1024 });
    vi.mocked(converter.pdfToMd).mockResolvedValue('# converted');
    service.selectedFile.set(new File(['pdf'], 'fallback.pdf', { type: 'application/pdf' }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    expect(service.entitlementMode()).toBe('public_byok');
    expect(service.error()).toBeNull();
    expect(converter.inspectPdf).toHaveBeenCalledTimes(1);
    expect(converter.pdfToMd).toHaveBeenCalledWith(expect.any(File), 'auto', 'test-key');
  });
});

describe('EntitlementService', () => {
  let service: EntitlementService;
  let approvedUserLookup: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    approvedUserLookup = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        EntitlementService,
        { provide: APPROVED_USER_LOOKUP, useValue: approvedUserLookup }
      ]
    });

    service = TestBed.inject(EntitlementService);
  });

  it('resolves approved_server mode from approved_users lookup', async () => {
    approvedUserLookup.mockResolvedValue({
      exists: () => true,
      data: () => ({ enabled: true })
    } as any);

    await expect(service.resolveMode('Approved.User@Example.com')).resolves.toBe('approved_server');
    expect(approvedUserLookup).toHaveBeenCalledWith('approved.user@example.com');
  });

  it.each([
    { label: 'disabled', data: { enabled: false } },
    { label: 'missing enabled', data: {} },
    { label: 'non-boolean enabled', data: { enabled: 'yes' } }
  ])('does not grant approved_server for $label approved_users documents', async ({ data }) => {
    approvedUserLookup.mockResolvedValue({
      exists: () => true,
      data: () => data
    } as any);

    await expect(service.resolveMode('approved.user@example.com')).resolves.toBe('public_byok');
  });
});
