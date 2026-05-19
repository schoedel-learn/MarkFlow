import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CoreStateService } from '../core-state';
import { WebLayoutComponent } from './web-layout';

describe('WebLayoutComponent', () => {
  let component: WebLayoutComponent;
  let fixture: ComponentFixture<WebLayoutComponent>;
  let state: any;

  beforeEach(async () => {
    state = {
      isAuthReady: signal(true),
      user: signal({ uid: 'u1', email: 'user@example.com', displayName: 'User', photoURL: '' }),
      geminiKey: signal(''),
      error: signal<string | null>(null),
      rememberKey: signal(true),
      mode: signal<'md-to-doc' | 'doc-to-md'>('doc-to-md'),
      markdownFlavor: signal('auto'),
      selectedFile: signal<File | null>(null),
      fileContent: signal<string | null>(null),
      convertedText: signal<string | null>(null),
      conversionType: signal('Markdown'),
      copied: signal(false),
      processingAction: signal<'pdf' | 'docx' | 'md' | 'txt' | null>(null),
      hasConverted: signal(false),
      entitlementMode: signal<'public_byok' | 'approved_server'>('public_byok'),
      approvedPdfJob: signal<any>(null),
      saveGeminiKey: () => {},
      toggleRememberKey: () => {},
      logout: async () => {},
      login: async () => {},
      setMode: () => {},
      convertToPdf: async () => {},
      convertToDocx: async () => {},
      convertToText: async () => {},
      convertToMarkdown: async () => {},
      reset: () => {},
      copyToClipboard: async () => {},
    };

    await TestBed.configureTestingModule({
      imports: [WebLayoutComponent],
      providers: [
        { provide: CoreStateService, useValue: state }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WebLayoutComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the public PDF contact notice for non-approved users', () => {
    state.entitlementMode.set('public_byok');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('10 MB and 25 pages');
    expect(text).toContain('barry@schoedeldesign.ai');
  });

  it('shows the approved-user server-managed notice', () => {
    state.entitlementMode.set('approved_server');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('approved for server-managed PDF conversion');
    // Permanent size-limits card still renders the contact email for everyone.
    expect(text).toContain('barry@schoedeldesign.ai');
  });

  it('shows queued approved PDF background job status', () => {
    state.entitlementMode.set('approved_server');
    state.approvedPdfJob.set({ jobId: 'job-123', status: 'queued' });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('PDF background job queued');
    expect(text).toContain('job-123');
  });
});
