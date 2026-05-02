import { ChangeDetectionStrategy, Component, signal, inject, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConverterService, MarkdownFlavor } from './converter.service';
import { MatIconModule } from '@angular/material/icon';
import { auth, signInWithGoogle, logOut, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, addDoc, writeBatch, increment } from 'firebase/firestore';

type ConversionMode = 'md-to-doc' | 'doc-to-md';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private converter = inject(ConverterService);
  
  mode = signal<ConversionMode>('md-to-doc');
  markdownFlavor = signal<MarkdownFlavor>('auto');
  processingAction = signal<'pdf' | 'docx' | 'md' | 'txt' | null>(null);
  error = signal<string | null>(null);
  
  // Auth & AI Key
  user = signal<User | null>(null);
  isAuthReady = signal<boolean>(false);
  
  // Menu state
  isProfileMenuOpen = signal<boolean>(false);
  
  // Bug Report state
  isBugReportModalOpen = signal<boolean>(false);
  bugReportText = signal<string>('');
  isSubmittingBugReport = signal<boolean>(false);
  bugReportSuccess = signal<boolean>(false);

  // For MD to Doc
  selectedFile = signal<File | null>(null);
  fileContent = signal<string | null>(null);
  convertedText = signal<string | null>(null);

  ngOnInit() {
    onAuthStateChanged(auth, async (user) => {
      this.user.set(user);
      this.isAuthReady.set(true);
      if (user) {
        if (!sessionStorage.getItem('login_recorded')) {
          sessionStorage.setItem('login_recorded', 'true');
          this.recordStat('logins');
        }
        // Ensure user profile is in Firestore
        try {
          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            createdAt: new Date()
          }, { merge: true });
        } catch (e) {
          console.error("Error saving user profile", e);
        }
      }
    });
  }

  async login() {
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error("Login failed", e);
    }
  }

  async logout() {
    try {
      sessionStorage.removeItem('login_recorded');
      await logOut();
      this.closeProfileMenu();
    } catch (e) {
      console.error("Logout failed", e);
    }
  }

  async recordStat(type: 'logins' | 'requests') {
    try {
      const d = new Date();
      const day = d.toISOString().split('T')[0];
      const month = day.substring(0, 7);
      const year = day.substring(0, 4);
      
      const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = d2.getUTCDay() || 7;
      d2.setUTCDate(d2.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d2.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      const week = `${d2.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;

      const batch = writeBatch(db);
      
      const refs = [
        doc(db, 'stats', `day_${day}`),
        doc(db, 'stats', `week_${week}`),
        doc(db, 'stats', `month_${month}`),
        doc(db, 'stats', `year_${year}`),
        doc(db, 'stats', `total`)
      ];

      refs.forEach(ref => {
        batch.set(ref, { [type]: increment(1) }, { merge: true });
      });

      await batch.commit();
    } catch (e) {
      console.error("Failed to record stat", e);
    }
  }

  toggleProfileMenu() {
    this.isProfileMenuOpen.update(v => !v);
  }

  closeProfileMenu() {
    this.isProfileMenuOpen.set(false);
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
      // TODO: Implement SendGrid API call here later.
      // Example: await fetch('https://api.sendgrid.com/v3/mail/send', { ... })
      // Sending to: contact@schoedel.design
      
      // For now, let's log it to Firestore so it's not lost before SendGrid is added
      const file = this.selectedFile();
      const documentType = file ? file.name.split('.').pop()?.toLowerCase() : 'none';

      await addDoc(collection(db, 'bug_reports'), {
        userId: this.user()?.uid || 'anonymous',
        userEmail: this.user()?.email || 'anonymous',
        description: this.bugReportText(),
        timestamp: new Date().toISOString(),
        status: 'new',
        appState: {
          converterMode: this.mode(),
          documentType: documentType
        }
      });

      // Simulate network delay for UX
      await new Promise(resolve => setTimeout(resolve, 800));
      
      this.bugReportSuccess.set(true);
    } catch (e) {
      console.error("Failed to submit bug report", e);
      this.error.set("Failed to submit bug report. Please try again.");
    } finally {
      this.isSubmittingBugReport.set(false);
    }
  }

  setMode(m: ConversionMode) {
    this.mode.set(m);
    this.reset();
  }

  reset() {
    this.selectedFile.set(null);
    this.fileContent.set(null);
    this.convertedText.set(null);
    this.error.set(null);
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.selectedFile.set(file);
    this.error.set(null);

    if (this.mode() === 'md-to-doc') {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.fileContent.set(e.target?.result as string);
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
        this.fileContent.set(text);
        const ext = this.mode() === 'md-to-doc' ? 'md' : 'txt';
        this.selectedFile.set(new File([text], `typed-content.${ext}`, { type: 'text/plain' }));
        this.error.set(null);
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

    if (this.mode() === 'md-to-doc') {
      const text = clipboardData.getData('text/plain');
      if (text) {
        event.preventDefault();
        this.fileContent.set(text);
        this.selectedFile.set(new File([text], 'pasted-snippet.md', { type: 'text/markdown' }));
        this.error.set(null);
      }
    } else {
      const html = clipboardData.getData('text/html');
      const text = clipboardData.getData('text/plain');
      if (html) {
        event.preventDefault();
        this.selectedFile.set(new File([html], 'pasted-content.html', { type: 'text/html' }));
        this.error.set(null);
      } else if (text) {
        event.preventDefault();
        this.selectedFile.set(new File([text], 'pasted-content.txt', { type: 'text/plain' }));
        this.error.set(null);
      }
    }
  }

  async canConvert(): Promise<boolean> {
    if (!this.user()) return false;
    const email = this.user()?.email;
    if (email === 'schoedelb@gmail.com') return true;

    try {
      const userRef = doc(db, 'users', this.user()!.uid);
      const userSnap = await getDoc(userRef);
      
      const today = new Date().toISOString().split('T')[0];
      let count = 0;
      let lastDate = '';

      if (userSnap.exists()) {
        const data = userSnap.data();
        count = data['conversionsToday'] || 0;
        lastDate = data['lastConversionDate'] || '';
      }

      if (lastDate === today && count >= 5) {
        this.error.set("You've reached your daily limit of 5 conversions. We hope you're enjoying MarkFlow! Please come back tomorrow to convert more documents.");
        return false;
      }
      return true;
    } catch (e) {
      console.error("Error checking conversion limit", e);
      this.error.set("Could not verify conversion limits. Please try again.");
      return false;
    }
  }

  async incrementConversionCount() {
    if (!this.user()) return;
    const email = this.user()?.email;
    if (email === 'schoedelb@gmail.com') return;

    try {
      const userRef = doc(db, 'users', this.user()!.uid);
      const userSnap = await getDoc(userRef);
      
      const today = new Date().toISOString().split('T')[0];
      let count = 0;
      let lastDate = '';

      if (userSnap.exists()) {
        const data = userSnap.data();
        count = data['conversionsToday'] || 0;
        lastDate = data['lastConversionDate'] || '';
      }

      if (lastDate !== today) {
        count = 0;
      }

      await setDoc(userRef, {
        conversionsToday: count + 1,
        lastConversionDate: today
      }, { merge: true });

      await this.recordStat('requests');
    } catch (e) {
      console.error("Error incrementing conversion count", e);
    }
  }

  async logErrorToFirestore(action: string, error: unknown, additionalData: Record<string, unknown> = {}) {
    if (!this.user()) return;
    try {
      const errorData = {
        action,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : null,
        timestamp: new Date().toISOString(),
        userId: this.user()?.uid || 'anonymous',
        userEmail: this.user()?.email || 'anonymous',
        ...additionalData
      };
      await addDoc(collection(db, 'conversion_errors'), errorData);
      console.info('Error logged to Firestore successfully.');
    } catch (e) {
      console.error('Failed to log error to Firestore', e);
    }
  }

  async convertToPdf() {
    if (!(await this.canConvert())) return;

    const content = this.fileContent();
    const file = this.selectedFile();
    if (!content || !file) return;

    this.processingAction.set('pdf');
    try {
      await this.converter.mdToPdf(content, file.name, this.markdownFlavor());
      await this.incrementConversionCount();
    } catch (err) {
      this.error.set('Failed to convert to PDF');
      console.error(err);
      await this.logErrorToFirestore('mdToPdf', err, { filename: file.name });
    } finally {
      this.processingAction.set(null);
    }
  }

  async convertToDocx() {
    if (!(await this.canConvert())) return;

    const content = this.fileContent();
    const file = this.selectedFile();
    if (!content || !file) return;

    this.processingAction.set('docx');
    try {
      await this.converter.mdToDocx(content, file.name, this.markdownFlavor());
      await this.incrementConversionCount();
    } catch (err) {
      this.error.set('Failed to convert to Word');
      console.error(err);
      await this.logErrorToFirestore('mdToDocx', err, { filename: file.name });
    } finally {
      this.processingAction.set(null);
    }
  }

  async convertToMarkdown() {
    if (!(await this.canConvert())) return;

    const file = this.selectedFile();
    if (!file) return;

    this.processingAction.set('md');
    try {
      let md = '';
      if (file.name.endsWith('.docx')) {
        md = await this.converter.docxToMd(file, this.markdownFlavor());
      } else if (file.name.endsWith('.pdf')) {
        md = await this.converter.pdfToMd(file, this.markdownFlavor());
      } else if (file.name.endsWith('.html')) {
        md = await this.converter.htmlToMd(await file.text(), this.markdownFlavor());
      } else if (file.name.endsWith('.txt')) {
        md = await file.text();
      } else {
        throw new Error('Unsupported file format');
      }

      this.downloadFile(md, file.name.replace(/\.(docx|pdf|html|txt)$/, '.md'), 'text/markdown');
      await this.incrementConversionCount();
    } catch (err) {
      this.error.set('Failed to convert to Markdown');
      console.error(err);
      await this.logErrorToFirestore('toMarkdown', err, { filename: file.name });
    } finally {
      this.processingAction.set(null);
    }
  }

  async convertToText() {
    if (!(await this.canConvert())) return;

    const file = this.selectedFile();
    const content = this.fileContent();
    if (!file && !content) return;

    this.processingAction.set('txt');
    try {
      const text = await this.converter.toPlainText(this.mode() === 'md-to-doc' ? content! : file!);
      this.downloadFile(text, (file?.name || 'document').replace(/\.(md|docx|pdf|html|txt)$/, '.txt'), 'text/plain');
      await this.incrementConversionCount();
    } catch (err) {
      this.error.set('Failed to convert to Plain Text');
      console.error(err);
      await this.logErrorToFirestore('toPlainText', err, { filename: file?.name });
    } finally {
      this.processingAction.set(null);
    }
  }

  private downloadFile(content: string, filename: string, type: string) {
    this.convertedText.set(content);
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }
}

