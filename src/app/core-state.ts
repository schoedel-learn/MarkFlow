import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ConverterService, MarkdownFlavor } from './converter.service';
import { auth, signInWithGoogle, logOut, db } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, getDoc, collection, addDoc, writeBatch, increment } from 'firebase/firestore';
import { EntitlementMode, EntitlementService } from './entitlement.service';
import { buildPublicPdfLimitMessage, exceedsPublicPdfPolicy, PdfInspectionMetadata, PUBLIC_PDF_MAX_BYTES } from './pdf-access-policy';

export type ConversionMode = 'md-to-doc' | 'doc-to-md';

@Injectable({
  providedIn: 'root'
})
export class CoreStateService {
  private converter = inject(ConverterService);
  private entitlementService = inject(EntitlementService);
  private platformId = inject(PLATFORM_ID);
  private entitlementCacheEmail: string | null = null;
  
  mode = signal<ConversionMode>('md-to-doc');
  markdownFlavor = signal<MarkdownFlavor>('auto');
  processingAction = signal<'pdf' | 'docx' | 'md' | 'txt' | null>(null);
  error = signal<string | null>(null);
  entitlementMode = signal<EntitlementMode>('public_byok');
  
  // Auth & AI Key
  user = signal<User | null>(null);
  isAuthReady = signal<boolean>(false);
  
  // For MD to Doc
  selectedFile = signal<File | null>(null);
  fileContent = signal<string | null>(null);
  convertedText = signal<string | null>(null);
  conversionType = signal<string>('Markdown');
  hasConverted = signal<boolean>(false);

  // BYOK
  geminiKey = signal<string>('');
  rememberKey = signal<boolean>(true);

  // Stats
  copied = signal<boolean>(false);

  initAuth() {
    onAuthStateChanged(auth, async (user) => {
      this.user.set(user);
      this.isAuthReady.set(true);
      this.entitlementCacheEmail = null;
      this.entitlementMode.set('public_byok');
      if (user) {
        if (!sessionStorage.getItem('login_recorded')) {
          sessionStorage.setItem('login_recorded', 'true');
          this.recordStat('logins');
        }
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

        try {
          await this.resolveEntitlementMode();
        } catch (e) {
          console.error('Error preloading entitlement mode', e);
        }
      }
    });

    if (isPlatformBrowser(this.platformId)) {
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey) {
        this.geminiKey.set(savedKey);
        this.rememberKey.set(true);
      }
    }
  }

  saveGeminiKey(key: string) {
    this.geminiKey.set(key);
    if (this.rememberKey() && isPlatformBrowser(this.platformId)) {
      localStorage.setItem('gemini_api_key', key);
    }
  }

  toggleRememberKey(remember: boolean) {
    this.rememberKey.set(remember);
    if (isPlatformBrowser(this.platformId)) {
      if (!remember) {
        localStorage.removeItem('gemini_api_key');
      } else if (this.geminiKey()) {
        localStorage.setItem('gemini_api_key', this.geminiKey());
      }
    }
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

  setMode(m: ConversionMode) {
    this.mode.set(m);
    this.reset();
  }

  reset() {
    this.selectedFile.set(null);
    this.fileContent.set(null);
    this.convertedText.set(null);
    this.error.set(null);
    this.hasConverted.set(false);
  }

  async canConvert(requireAuthOptions: { showProfileMenuFn: () => void; allowMissingGeminiKey?: boolean } = { showProfileMenuFn: () => {} }): Promise<boolean> {
    if (!this.user()) return false;

    const email = this.user()?.email;
    if (email === 'schoedelb@gmail.com') return true;

    if (!this.geminiKey() && !requireAuthOptions.allowMissingGeminiKey) {
      this.error.set("Please provide your Gemini API key in your Profile menu to convert documents.");
      requireAuthOptions.showProfileMenuFn();
      return false;
    }

    return this.checkDailyConversionLimit();
  }

  private async resolveEntitlementMode(options: { forceRefresh?: boolean } = {}): Promise<EntitlementMode> {
    const normalizedEmail = this.user()?.email?.trim().toLowerCase() ?? null;

    if (!normalizedEmail) {
      this.entitlementCacheEmail = null;
      this.entitlementMode.set('public_byok');
      return 'public_byok';
    }

    if (!options.forceRefresh && this.entitlementCacheEmail === normalizedEmail) {
      return this.entitlementMode();
    }

    const mode = await this.entitlementService.resolveMode(normalizedEmail);
    this.entitlementCacheEmail = normalizedEmail;
    this.entitlementMode.set(mode);
    return mode;
  }

  private async checkDailyConversionLimit(): Promise<boolean> {

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

  private isPdfFile(file: File): boolean {
    const fileName = file.name.toLowerCase();
    return file.type === 'application/pdf' || fileName.endsWith('.pdf');
  }

  private async getPdfMetadata(file: File): Promise<PdfInspectionMetadata> {
    return this.converter.inspectPdf(file);
  }

  private async enforcePublicPdfPolicy(file: File): Promise<boolean> {
    if (this.entitlementMode() !== 'public_byok' || !this.isPdfFile(file)) {
      return true;
    }

    if (file.size > PUBLIC_PDF_MAX_BYTES) {
      this.error.set(buildPublicPdfLimitMessage({ sizeBytes: file.size }));
      return false;
    }

    const metadata = await this.getPdfMetadata(file);
    if (!exceedsPublicPdfPolicy(metadata)) {
      return true;
    }

    this.error.set(buildPublicPdfLimitMessage(metadata));
    return false;
  }

  async incrementConversionCount() {
    this.hasConverted.set(true);
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
    } catch (e) {
      console.error('Failed to log error to Firestore', e);
    }
  }

  async convertToPdf(requireAuthOptions: any) {
    if (!(await this.canConvert(requireAuthOptions))) return;

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

  async convertToDocx(requireAuthOptions: any) {
    if (!(await this.canConvert(requireAuthOptions))) return;

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

  async convertToMarkdown(requireAuthOptions: any) {
    const file = this.selectedFile();
    if (!file) return;

    const isPdf = this.isPdfFile(file);
    let allowServerManagedPdf = false;

    if (isPdf) {
      try {
        allowServerManagedPdf = (await this.resolveEntitlementMode({ forceRefresh: true })) === 'approved_server';
      } catch (e) {
        console.error('Error resolving entitlement mode', e);
        this.entitlementMode.set('public_byok');
      }
    }

    if (!(await this.canConvert({ ...requireAuthOptions, allowMissingGeminiKey: allowServerManagedPdf }))) return;
    if (!(await this.enforcePublicPdfPolicy(file))) return;

    this.processingAction.set('md');
    this.conversionType.set('Markdown');
    try {
      let md = '';
      if (file.name.endsWith('.docx')) {
        md = await this.converter.docxToMd(file, this.markdownFlavor(), this.geminiKey());
      } else if (file.name.endsWith('.pdf')) {
        md = await this.converter.pdfToMd(file, this.markdownFlavor(), this.geminiKey());
      } else if (file.name.endsWith('.html')) {
        md = await this.converter.htmlToMd(await file.text(), this.markdownFlavor(), this.geminiKey());
      } else if (file.name.endsWith('.txt')) {
        md = await this.converter.textToMd(await file.text(), this.markdownFlavor(), this.geminiKey());
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

  async convertToText(requireAuthOptions: any) {
    if (!(await this.canConvert(requireAuthOptions))) return;

    const file = this.selectedFile();
    const content = this.fileContent();
    if (!file && !content) return;

    this.processingAction.set('txt');
    this.conversionType.set('Plain Text');
    try {
      const text = await this.converter.toPlainText(this.mode() === 'md-to-doc' ? content! : file!, this.geminiKey());
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

  async copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  }
}
