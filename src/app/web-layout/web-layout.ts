import { ChangeDetectionStrategy, Component, signal, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CoreStateService } from '../core-state';
import { MatIconModule } from '@angular/material/icon';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';
import { PUBLIC_PDF_CONTACT_EMAIL } from '../pdf-access-policy';
import { BackendKeyStatus, ServerPdfService } from '../server-pdf.service';
import { ThemeService, ThemePreference } from '../theme.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-web-layout',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './web-layout.html',
  styleUrl: '../app.css', // Share styles with main app
})
export class WebLayoutComponent {
  public state = inject(CoreStateService);
  public theme = inject(ThemeService);
  private readonly serverPdf = inject(ServerPdfService);
  readonly publicPdfContactEmail = PUBLIC_PDF_CONTACT_EMAIL;
  readonly themeOptions: ThemePreference[] = ['auto', 'light', 'dark'];

  // UI State specific to web layout
  isProfileMenuOpen = signal<boolean>(false);
  isBugReportModalOpen = signal<boolean>(false);
  bugReportText = signal<string>('');
  isSubmittingBugReport = signal<boolean>(false);
  bugReportSuccess = signal<boolean>(false);
  contactEmailCopied = signal<boolean>(false);
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  // Backend-stored Gemini key (approved users only)
  backendKeyStatus = signal<BackendKeyStatus | null>(null);
  backendKeyInput = signal<string>('');
  backendKeyLoading = signal<boolean>(false);
  backendKeySaving = signal<boolean>(false);
  backendKeyMessage = signal<string | null>(null);
  backendKeyError = signal<string | null>(null);

  async copyContactEmail() {
    const email = this.publicPdfContactEmail;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = email;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.contactEmailCopied.set(true);
      if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
      this.copyResetTimer = setTimeout(() => this.contactEmailCopied.set(false), 2000);
    } catch {
      this.contactEmailCopied.set(false);
    }
  }

  toggleProfileMenu() {
    this.isProfileMenuOpen.update(v => !v);
    if (this.isProfileMenuOpen() && this.state.entitlementMode() === 'approved_server') {
      void this.loadBackendKeyStatus();
    }
  }

  closeProfileMenu() {
    this.isProfileMenuOpen.set(false);
  }

  setThemePreference(pref: ThemePreference) {
    this.theme.setPreference(pref);
  }

  updateBackendKeyInput(value: string) {
    this.backendKeyInput.set(value);
  }

  async loadBackendKeyStatus() {
    if (this.backendKeyLoading()) return;
    this.backendKeyLoading.set(true);
    this.backendKeyError.set(null);
    try {
      const status = await this.serverPdf.getBackendKeyStatus();
      this.backendKeyStatus.set(status);
    } catch (e) {
      this.backendKeyError.set(e instanceof Error ? e.message : 'Failed to load backend key status.');
    } finally {
      this.backendKeyLoading.set(false);
    }
  }

  async saveBackendKey() {
    const value = this.backendKeyInput().trim();
    if (!value || this.backendKeySaving()) return;
    this.backendKeySaving.set(true);
    this.backendKeyError.set(null);
    this.backendKeyMessage.set(null);
    try {
      const status = await this.serverPdf.setBackendKey(value);
      this.backendKeyStatus.set(status);
      this.backendKeyInput.set('');
      this.backendKeyMessage.set('Saved on server.');
    } catch (e) {
      this.backendKeyError.set(e instanceof Error ? e.message : 'Failed to save backend key.');
    } finally {
      this.backendKeySaving.set(false);
    }
  }

  async clearBackendKey() {
    if (this.backendKeySaving()) return;
    this.backendKeySaving.set(true);
    this.backendKeyError.set(null);
    this.backendKeyMessage.set(null);
    try {
      const status = await this.serverPdf.clearBackendKey();
      this.backendKeyStatus.set(status);
      this.backendKeyMessage.set('Removed from server.');
    } catch (e) {
      this.backendKeyError.set(e instanceof Error ? e.message : 'Failed to clear backend key.');
    } finally {
      this.backendKeySaving.set(false);
    }
  }

  submitGeminiKey() {
    if (this.state.geminiKey()) {
      if (this.state.error()?.includes('Gemini API key')) {
        this.state.error.set(null);
      }
      this.closeProfileMenu();
    }
  }

  openBugReportModal() {
    this.isBugReportModalOpen.set(true);
    this.bugReportText.set('');
    this.bugReportSuccess.set(false);
  }

  closeBugReportModal() {
    this.isBugReportModalOpen.set(false);
  }

  updateBugReportText(text: string) {
    this.bugReportText.set(text);
  }

  async submitBugReport() {
    if (!this.bugReportText().trim()) return;
    
    this.isSubmittingBugReport.set(true);
    
    try {
      const file = this.state.selectedFile();
      const documentType = file ? file.name.split('.').pop()?.toLowerCase() : 'none';

      await addDoc(collection(db, 'bug_reports'), {
        userId: this.state.user()?.uid || 'anonymous',
        userEmail: this.state.user()?.email || 'anonymous',
        description: this.bugReportText(),
        timestamp: new Date().toISOString(),
        status: 'new',
        appState: {
          converterMode: this.state.mode(),
          documentType: documentType
        }
      });

      await new Promise(resolve => setTimeout(resolve, 800));
      this.bugReportSuccess.set(true);
    } catch (e) {
      console.error("Failed to submit bug report", e);
      this.state.error.set("Failed to submit bug report. Please try again.");
    } finally {
      this.isSubmittingBugReport.set(false);
    }
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.state.selectedFile.set(file);
    this.state.error.set(null);

    if (this.state.mode() === 'md-to-doc') {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.state.fileContent.set(e.target?.result as string);
      };
      reader.readAsText(file);
    }
  }

  pasteTimeout: ReturnType<typeof setTimeout> | undefined;
  onTextInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    const text = target.value;
    
    clearTimeout(this.pasteTimeout);
    this.pasteTimeout = setTimeout(() => {
      if (text.trim()) {
        this.state.fileContent.set(text);
        const ext = this.state.mode() === 'md-to-doc' ? 'md' : 'txt';
        this.state.selectedFile.set(new File([text], `typed-content.${ext}`, { type: 'text/plain' }));
        this.state.error.set(null);
        target.value = '';
      }
    }, 1000);
  }

  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent) {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || (target.tagName === 'TEXTAREA' && target.id !== 'main-paste-area')) return;

    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    if (target.tagName === 'TEXTAREA') {
      setTimeout(() => {
        (target as HTMLTextAreaElement).value = '';
      }, 500);
    }

    if (this.state.mode() === 'md-to-doc') {
      const text = clipboardData.getData('text/plain');
      if (text) {
        event.preventDefault();
        this.state.fileContent.set(text);
        this.state.selectedFile.set(new File([text], 'pasted-snippet.md', { type: 'text/markdown' }));
        this.state.error.set(null);
      }
    } else {
      const html = clipboardData.getData('text/html');
      const text = clipboardData.getData('text/plain');
      if (html) {
        event.preventDefault();
        this.state.selectedFile.set(new File([html], 'pasted-content.html', { type: 'text/html' }));
        this.state.error.set(null);
      } else if (text) {
        event.preventDefault();
        this.state.selectedFile.set(new File([text], 'pasted-content.txt', { type: 'text/plain' }));
        this.state.error.set(null);
      }
    }
  }

  get requireAuthOptions() {
    return { showProfileMenuFn: () => this.isProfileMenuOpen.set(true) };
  }

  get showPdfAccessNotice() {
    return this.state.mode() === 'doc-to-md' && !!this.state.user();
  }

  get isApprovedUser() {
    return this.state.entitlementMode() === 'approved_server';
  }

  get showApprovedPdfJobNotice() {
    return this.state.mode() === 'doc-to-md' && !!this.state.approvedPdfJob();
  }
}
