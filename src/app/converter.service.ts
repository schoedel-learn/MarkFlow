import { Injectable } from '@angular/core';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import * as mammoth from 'mammoth';
import TurndownService from 'turndown';
import * as pdfjsLib from 'pdfjs-dist';

@Injectable({
  providedIn: 'root'
})
export class ConverterService {
  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  constructor() {
    try {
      // Set worker for pdfjs
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
    } catch (e) {
      console.error('Failed to set pdfjs worker', e);
    }
  }

  async mdToHtml(md: string): Promise<string> {
    return marked.parse(md) as string;
  }

  async mdToPdf(md: string, filename: string): Promise<void> {
    const html = await this.mdToHtml(md);
    const container = document.createElement('div');
    
    // Explicitly set hex colors to avoid oklch issues in html2canvas
    container.style.width = '800px';
    container.style.padding = '60px';
    container.style.backgroundColor = '#ffffff';
    container.style.color = '#1c1917';
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.opacity = '0';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '-1';
    container.style.fontFamily = 'Inter, sans-serif';
    
    container.innerHTML = `
      <style>
        .pdf-content { font-family: Inter, sans-serif; color: #1c1917; line-height: 1.6; }
        .pdf-content h1 { font-size: 2.5rem; margin-bottom: 1.5rem; color: #1c1917; }
        .pdf-content h2 { font-size: 2rem; margin-top: 2rem; margin-bottom: 1rem; color: #1c1917; }
        .pdf-content p { margin-bottom: 1rem; }
        .pdf-content ul, .pdf-content ol { margin-bottom: 1rem; padding-left: 1.5rem; }
        .pdf-content li { margin-bottom: 0.5rem; }
        .pdf-content code { background-color: #f5f5f4; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: monospace; }
        .pdf-content pre { background-color: #f5f5f4; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1rem; }
        .pdf-content blockquote { border-left: 4px solid #e7e5e4; padding-left: 1rem; font-style: italic; color: #57534e; margin-bottom: 1rem; }
        .pdf-content img { max-width: 100%; height: auto; }
      </style>
      <div class="pdf-content">${html}</div>
    `;
    
    document.body.appendChild(container);

    // Give it a moment to render and load any images
    await new Promise(resolve => setTimeout(resolve, 800));

    try {
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: true,
        backgroundColor: '#ffffff',
        windowWidth: 800
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      // Handle multi-page PDF
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save(filename.replace(/\.(md|txt)$/, '.pdf'));
    } catch (error) {
      console.error('PDF Conversion Error:', error);
      throw error;
    } finally {
      document.body.removeChild(container);
    }
  }

  async mdToDocx(md: string, filename: string): Promise<void> {
    const tokens = marked.lexer(md);
    const children: Paragraph[] = [];

    interface MarkdownToken {
      type: string;
      text?: string;
      tokens?: MarkdownToken[];
      depth?: number;
      items?: { tokens?: MarkdownToken[] }[];
    }

    interface InlineStyles {
      bold?: boolean;
      italics?: boolean;
      font?: string;
      color?: string;
      underline?: object;
    }

    const processInline = (tokens: MarkdownToken[], styles: InlineStyles = {}): TextRun[] => {
      const runs: TextRun[] = [];
      for (const token of tokens) {
        if (token.type === 'text' && token.text) {
          runs.push(new TextRun({ text: token.text, ...styles }));
        } else if (token.type === 'strong') {
          runs.push(...processInline(token.tokens || [], { ...styles, bold: true }));
        } else if (token.type === 'em') {
          runs.push(...processInline(token.tokens || [], { ...styles, italics: true }));
        } else if (token.type === 'codespan' && token.text) {
          runs.push(new TextRun({ text: token.text, font: 'Courier New', ...styles }));
        } else if (token.type === 'link') {
          runs.push(...processInline(token.tokens || [], { ...styles, color: '0000FF', underline: {} }));
        } else if (token.tokens) {
          runs.push(...processInline(token.tokens, styles));
        }
      }
      return runs;
    };

    const castTokens = tokens as unknown as MarkdownToken[];
    for (const token of castTokens) {
      if (token.type === 'heading') {
        const level = token.depth === 2 ? HeadingLevel.HEADING_2 : 
                      token.depth === 3 ? HeadingLevel.HEADING_3 : 
                      HeadingLevel.HEADING_1;
        
        children.push(new Paragraph({
          children: processInline(token.tokens || []),
          heading: level
        }));
      } else if (token.type === 'paragraph') {
        children.push(new Paragraph({
          children: processInline(token.tokens || [])
        }));
      } else if (token.type === 'space') {
        children.push(new Paragraph({ text: '' }));
      } else if (token.type === 'list' && token.items) {
        for (const item of token.items) {
          children.push(new Paragraph({
            children: processInline(item.tokens || []),
            bullet: { level: 0 }
          }));
        }
      }
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: children
      }]
    });

    const blob = await Packer.toBlob(doc);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/\.(md|txt)$/, '.docx');
    a.click();
    window.URL.revokeObjectURL(url);
  }

  async docxToMd(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const html = result.value;
    return this.turndownService.turndown(html);
  }

  async pdfToMd(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: unknown) => (item as { str: string }).str)
        .join(' ');
      fullText += pageText + '\n\n';
    }


    // PDF to MD is inherently lossy without complex layout analysis
    // We'll return the extracted text which is technically valid markdown
    return fullText;
  }
}
