import { ChangeDetectionStrategy, Component, signal, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CoreStateService } from '../core-state';
import { MatIconModule } from '@angular/material/icon';
import { db } from '../firebase';
import { collection, addDoc } from 'firebase/firestore';

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

  // UI State specific to web layout
  isProfileMenuOpen = signal<boolean>(false);
  isBugReportModalOpen = signal<boolean>(false);
  bugReportText = signal<string>('');
  isSubmittingBugReport = signal<boolean>(false);
  bugReportSuccess = signal<boolean>(false);

  toggleProfileMenu() {
    this.isProfileMenuOpen.update(v => !v);
  }

  closeProfileMenu() {
    this.isProfileMenuOpen.set(false);
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
}
