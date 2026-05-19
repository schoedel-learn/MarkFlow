import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ConverterService } from './converter.service';
import { CoreStateService } from './core-state';
import { APPROVED_USER_LOOKUP, EntitlementService } from './entitlement.service';
import { buildPublicPdfLimitMessage, PUBLIC_PDF_MAX_PAGES } from './pdf-access-policy';

describe('CoreStateService', () => {
  let service: CoreStateService;
  let converter: Pick<ConverterService, 'inspectPdf' | 'pdfToMd'>;
  let entitlement: Pick<EntitlementService, 'resolveMode'>;

  beforeEach(() => {
    converter = {
      inspectPdf: vi.fn(),
      pdfToMd: vi.fn()
    };
    entitlement = {
      resolveMode: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        CoreStateService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ConverterService, useValue: converter },
        { provide: EntitlementService, useValue: entitlement }
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

  it('lets approved users bypass the public PDF block', async () => {
    vi.mocked(entitlement.resolveMode).mockResolvedValue('approved_server');
    vi.mocked(converter.inspectPdf).mockResolvedValue({ pageCount: PUBLIC_PDF_MAX_PAGES + 100, sizeBytes: 25 * 1024 * 1024 });
    vi.mocked(converter.pdfToMd).mockResolvedValue('# converted');
    service.selectedFile.set(new File(['pdf'], 'large.pdf', { type: 'application/pdf' }));

    await service.convertToMarkdown({ showProfileMenuFn: vi.fn() });

    expect(service.entitlementMode()).toBe('approved_server');
    expect(converter.inspectPdf).not.toHaveBeenCalled();
    expect(converter.pdfToMd).toHaveBeenCalledTimes(1);
  });

  it('lets approved users convert PDFs without a Gemini key', async () => {
    vi.mocked(entitlement.resolveMode).mockResolvedValue('approved_server');
    vi.mocked(converter.pdfToMd).mockResolvedValue('# converted');
    service.geminiKey.set('');
    service.selectedFile.set(new File(['pdf'], 'approved.pdf', { type: 'application/pdf' }));
    const showProfileMenuFn = vi.fn();

    await service.convertToMarkdown({ showProfileMenuFn });

    expect(service.entitlementMode()).toBe('approved_server');
    expect(showProfileMenuFn).not.toHaveBeenCalled();
    expect(service.error()).toBeNull();
    expect(converter.pdfToMd).toHaveBeenCalledWith(expect.any(File), 'auto', '');
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
