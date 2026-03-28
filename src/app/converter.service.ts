import { Injectable } from '@angular/core';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import * as mammoth from 'mammoth';
import TurndownService from 'turndown';
import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root'
})
export class ConverterService {
  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  constructor() {
    this.initializePdfWorker();
  }

  private async initializePdfWorker() {
    try {
      const version = '4.10.38';
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
    } catch (e) {
      console.error('Failed to set pdfjs worker', e);
    }
  }

  private getAiClient(): GoogleGenAI {
    return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }

  async mdToHtml(md: string): Promise<string> {
    console.info('[mdToHtml] Converting Markdown to HTML...');
    try {
      return marked.parse(md) as string;
    } catch (error) {
      console.error('[mdToHtml] Error parsing Markdown:', error);
      throw new Error(`Failed to parse Markdown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  htmlToMd(html: string): string {
    console.info('[htmlToMd] Converting HTML to Markdown...');
    try {
      return this.turndownService.turndown(html);
    } catch (error) {
      console.error('[htmlToMd] Error converting HTML to Markdown:', error);
      throw new Error(`Failed to convert HTML to Markdown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async mdToPdf(md: string, filename: string): Promise<void> {
    console.info('[mdToPdf] Starting PDF conversion process...');
    let container: HTMLDivElement | null = null;
    
    try {
      console.info('[mdToPdf] Converting Markdown to HTML...');
      const html = await this.mdToHtml(md);
      
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.backgroundColor = '#ffffff';
      container.style.color = '#1c1917';
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.zIndex = '-9999';
      
      container.innerHTML = `
        <style>
          .pdf-content { 
            font-family: "Reddit Sans", sans-serif; 
            color: #1c1917; 
            line-height: 1.6; 
            font-size: 12pt;
          }
          .pdf-content h1, .pdf-content h2, .pdf-content h3, .pdf-content h4 { 
            color: #1c1917; 
            page-break-after: avoid; 
            break-after: avoid;
            margin-top: 1.5em;
            margin-bottom: 0.5em;
            break-inside: avoid;
          }
          .pdf-content h1 { font-size: 2.25rem; }
          .pdf-content h2 { font-size: 1.8rem; }
          .pdf-content h3 { font-size: 1.5rem; }
          
          .pdf-content p, .pdf-content li, .pdf-content pre, .pdf-content blockquote { 
            page-break-inside: avoid; 
            break-inside: avoid; 
            margin-bottom: 1rem;
          }
          .pdf-content p, .pdf-content blockquote {
            orphans: 8;
            widows: 8;
          }
          .pdf-content ul, .pdf-content ol { 
            padding-left: 1.5rem; 
            margin-bottom: 1rem; 
          }
          .pdf-content code { 
            background-color: #f5f5f4; 
            padding: 0.2rem 0.4rem; 
            border-radius: 0.25rem; 
            font-family: "JetBrains Mono", monospace; 
            font-size: 0.9em;
          }
          .pdf-content pre { 
            background-color: #f5f5f4; 
            padding: 1rem; 
            border-radius: 0.5rem; 
            overflow-x: auto; 
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          .pdf-content blockquote { 
            border-left: 4px solid #e7e5e4; 
            padding-left: 1rem; 
            font-style: italic; 
            color: #57534e; 
          }
          .pdf-content img { 
            max-width: 100%; 
            height: auto; 
            page-break-inside: avoid; 
            break-inside: avoid; 
            display: block;
            margin: 1rem auto;
          }
        </style>
        <div class="pdf-content">${html}</div>
      `;
      
      document.body.appendChild(container);

      console.info('[mdToPdf] Waiting for images to load...');
      const images = container.getElementsByTagName('img');
      let loadedCount = 0;
      let failedCount = 0;
      
      const imagePromises = Array.from(images).map(img => {
        if (img.complete) {
          loadedCount++;
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          img.onload = () => {
            loadedCount++;
            resolve(null);
          };
          img.onerror = (err) => {
            failedCount++;
            console.warn(`[mdToPdf] Failed to load image: ${img.src}`, err);
            resolve(null); // Resolve anyway to not block rendering
          };
        });
      });

      await Promise.all(imagePromises);
      console.info(`[mdToPdf] Image loading complete. Loaded: ${loadedCount}, Failed: ${failedCount}`);

      console.info('[mdToPdf] Waiting for styles and fonts to apply...');
      await new Promise(resolve => setTimeout(resolve, 500));

      console.info('[mdToPdf] Initializing jsPDF and html2canvas...');
      (window as unknown as { html2canvas: typeof html2canvas }).html2canvas = html2canvas;
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'in',
        format: 'letter'
      });

      console.info('[mdToPdf] Rendering HTML to PDF via jsPDF...');
      await new Promise<void>((resolve, reject) => {
        pdf.html(container!, {
          margin: [1, 1, 1, 1],
          autoPaging: 'text',
          x: 0,
          y: 0,
          width: 6.5,
          windowWidth: 800,
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: true,
            backgroundColor: '#ffffff'
          },
          callback: function (doc: jsPDF) {
            try {
              console.info('[mdToPdf] Saving PDF file...');
              doc.save(filename.replace(/\.(md|txt)$/, '.pdf'));
              console.info('[mdToPdf] PDF generation completed successfully.');
              resolve();
            } catch (saveError) {
              console.error('[mdToPdf] Error saving PDF file:', saveError);
              reject(new Error(`Failed to save PDF: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`));
            }
          }
        } as unknown as Parameters<typeof pdf.html>[1]).catch((renderError) => {
          console.error('[mdToPdf] Error during HTML rendering:', renderError);
          reject(new Error(`Failed to render HTML to PDF: ${renderError instanceof Error ? renderError.message : 'Unknown error'}`));
        });
      });
      
    } catch (error) {
      console.error('[mdToPdf] Fatal PDF Conversion Error:', error);
      throw new Error(`Failed to generate PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (container && container.parentNode) {
        console.info('[mdToPdf] Cleaning up temporary HTML container...');
        container.parentNode.removeChild(container);
      }
    }
  }

  async mdToDocx(md: string, filename: string): Promise<void> {
    console.info('[mdToDocx] Starting DOCX conversion process...');
    try {
      console.info('[mdToDocx] Lexing Markdown...');
      // We use the local library for mdToDocx because generating a valid .docx file
      // via an LLM is error-prone and often results in corrupted files.
      // The local library is much more robust for this specific task.
      const tokens = marked.lexer(md);
      const children: Paragraph[] = [];

    interface MarkdownToken {
      type: string;
      text?: string;
      tokens?: MarkdownToken[];
      depth?: number;
      items?: { tokens?: MarkdownToken[] }[];
      ordered?: boolean;
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
    console.info('[mdToDocx] Processing Markdown tokens into DOCX paragraphs...');
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
          let indentLevel = 1;
          const firstToken = item.tokens?.[0];
          if (firstToken && firstToken.text) {
            const match = firstToken.text.match(/^([-]+)\s+/);
            if (match) {
              indentLevel += match[1].length;
              firstToken.text = firstToken.text.replace(/^[-]+\s+/, '');
            }
          }

          children.push(new Paragraph({
            children: processInline(item.tokens || []),
            bullet: token.ordered ? undefined : { level: Math.max(0, indentLevel - 1) },
            indent: { left: indentLevel * 720, hanging: 360 }
          }));
        }
      }
    }

    console.info('[mdToDocx] Generating DOCX document...');
    const doc = new Document({
      sections: [{
        properties: {},
        children: children
      }]
    });

    console.info('[mdToDocx] Creating blob and triggering download...');
    const blob = await Packer.toBlob(doc);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/\.(md|txt)$/, '.docx');
    a.click();
    window.URL.revokeObjectURL(url);
    console.info('[mdToDocx] DOCX generation completed successfully.');
    
    } catch (error) {
      console.error('[mdToDocx] Fatal DOCX Conversion Error:', error);
      throw new Error(`Failed to generate DOCX: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async docxToMd(file: File): Promise<string> {
    console.info(`[docxToMd] Starting conversion for file: ${file.name}`);
    try {
      console.info('[docxToMd] Reading file array buffer...');
      const arrayBuffer = await file.arrayBuffer();
      
      console.info('[docxToMd] Converting DOCX to HTML via mammoth...');
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const html = result.value;
      
      console.info('[docxToMd] Requesting AI conversion from HTML to Markdown...');
      // Use AI to convert the HTML to clean Markdown
      const ai = this.getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Convert the following HTML extracted from a Word document into clean, well-formatted Markdown. Preserve headings, lists, bold, italics, and links. Do not include any conversational text, just output the Markdown.\n\nHTML:\n${html}`,
      });
      
      console.info('[docxToMd] AI conversion completed successfully.');
      return response.text || this.turndownService.turndown(html);
    } catch (error) {
      console.error('[docxToMd] Fatal DOCX to MD Conversion Error:', error);
      throw new Error(`Failed to convert DOCX to MD: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async pdfToMd(file: File): Promise<string> {
    console.info(`[pdfToMd] Starting conversion for file: ${file.name}`);
    try {
      console.info('[pdfToMd] Reading file as base64...');
      const base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = () => reject(new Error('Failed to read PDF file'));
        reader.readAsDataURL(file);
      });
      
      console.info('[pdfToMd] Requesting AI conversion from PDF to Markdown...');
      const ai = this.getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64String,
                mimeType: 'application/pdf'
              }
            },
            {
              text: 'Extract the text from this PDF and format it as clean Markdown. Preserve the structure, headings, lists, and paragraphs. Do not include any conversational text, just output the Markdown.'
            }
          ]
        }
      });

      console.info('[pdfToMd] AI conversion completed successfully.');
      return response.text || '';
    } catch (error) {
      console.error('[pdfToMd] Fatal PDF to MD Conversion Error:', error);
      throw new Error(`Failed to convert PDF to MD: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
