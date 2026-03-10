import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConverterService } from './converter.service';
import { MatIconModule } from '@angular/material/icon';

type ConversionMode = 'md-to-doc' | 'doc-to-md';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private converter = inject(ConverterService);
  
  mode = signal<ConversionMode>('md-to-doc');
  processingAction = signal<'pdf' | 'docx' | 'md' | null>(null);
  error = signal<string | null>(null);
  
  // For MD to Doc
  selectedFile = signal<File | null>(null);
  fileContent = signal<string | null>(null);

  setMode(m: ConversionMode) {
    this.mode.set(m);
    this.reset();
  }

  reset() {
    this.selectedFile.set(null);
    this.fileContent.set(null);
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

  async convertToPdf() {
    const content = this.fileContent();
    const file = this.selectedFile();
    if (!content || !file) return;

    this.processingAction.set('pdf');
    try {
      await this.converter.mdToPdf(content, file.name);
    } catch (err) {
      this.error.set('Failed to convert to PDF');
      console.error(err);
    } finally {
      this.processingAction.set(null);
    }
  }

  async convertToDocx() {
    const content = this.fileContent();
    const file = this.selectedFile();
    if (!content || !file) return;

    this.processingAction.set('docx');
    try {
      await this.converter.mdToDocx(content, file.name);
    } catch (err) {
      this.error.set('Failed to convert to Word');
      console.error(err);
    } finally {
      this.processingAction.set(null);
    }
  }

  async convertToMarkdown() {
    const file = this.selectedFile();
    if (!file) return;

    this.processingAction.set('md');
    try {
      let md = '';
      if (file.name.endsWith('.docx')) {
        md = await this.converter.docxToMd(file);
      } else if (file.name.endsWith('.pdf')) {
        md = await this.converter.pdfToMd(file);
      } else {
        throw new Error('Unsupported file format');
      }

      this.downloadFile(md, file.name.replace(/\.(docx|pdf)$/, '.md'), 'text/markdown');
    } catch (err) {
      this.error.set('Failed to convert to Markdown');
      console.error(err);
    } finally {
      this.processingAction.set(null);
    }
  }

  private downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}

