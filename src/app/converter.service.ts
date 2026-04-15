import { Injectable } from '@angular/core';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, BorderStyle, WidthType, IParagraphOptions } from 'docx';
import * as mammoth from 'mammoth';
import TurndownService from 'turndown';
import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenAI } from '@google/genai';

export type MarkdownFlavor = 
  | 'auto' 
  | 'original' 
  | 'commonmark' 
  | 'multimarkdown' 
  | 'gfm' 
  | 'stackoverflow' 
  | 'reddit' 
  | 'pandoc' 
  | 'kramdown' 
  | 'mdx' 
  | 'obsidian';

@Injectable({
  providedIn: 'root'
})
export class ConverterService {
  private turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  private gfmTurndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });

  constructor() {
    this.initializePdfWorker();
    this.setupTurndownPlugins();
  }

  private async setupTurndownPlugins() {
    try {
      const { gfm } = await import('turndown-plugin-gfm');
      this.gfmTurndownService.use(gfm);
    } catch (e) {
      console.error('Failed to load turndown-plugin-gfm', e);
    }
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

  async mdToHtml(md: string, flavor: MarkdownFlavor = 'auto'): Promise<string> {
    console.info(`[mdToHtml] Converting Markdown (${flavor}) to HTML...`);
    try {
      const isGfm = flavor === 'gfm' || flavor === 'auto';
      const options = {
        gfm: isGfm,
        breaks: isGfm,
      };
      return marked.parse(md, options) as string;
    } catch (error) {
      console.error('[mdToHtml] Error parsing Markdown:', error);
      throw new Error(`Failed to parse Markdown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async htmlToMd(html: string, flavor: MarkdownFlavor = 'auto'): Promise<string> {
    console.info(`[htmlToMd] Converting HTML to Markdown (${flavor})...`);
    try {
      // Use AI for better quality conversion if possible
      const ai = this.getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Convert the following HTML into clean, well-formatted Markdown using ${flavor === 'commonmark' ? 'CommonMark' : 'GitHub Flavored Markdown'} syntax. Preserve headings, lists, bold, italics, and links. Do not include any conversational text, just output the Markdown.\n\nHTML:\n${html}`,
      });
      return response.text || this.getTurndownService(flavor).turndown(html);
    } catch (error) {
      console.warn('[htmlToMd] AI conversion failed, falling back to Turndown:', error);
      try {
        return this.getTurndownService(flavor).turndown(html);
      } catch (fallbackError) {
        console.error('[htmlToMd] Fallback conversion failed:', fallbackError);
        throw new Error(`Failed to convert HTML to Markdown: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
      }
    }
  }

  private getTurndownService(flavor: MarkdownFlavor): TurndownService {
    return flavor === 'commonmark' ? this.turndownService : this.gfmTurndownService;
  }

  async mdToPdf(md: string, filename: string, flavor: MarkdownFlavor = 'gfm'): Promise<void> {
    console.info('[mdToPdf] Starting PDF conversion process...');
    let container: HTMLDivElement | null = null;
    
    try {
      console.info('[mdToPdf] Converting Markdown to HTML...');
      const html = await this.mdToHtml(md, flavor);
      
      container = document.createElement('div');
      container.style.width = '672px'; // 7 inches at 96 DPI
      container.style.backgroundColor = '#ffffff';
      container.style.color = '#1c1917';
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.zIndex = '-9999';
      
      container.innerHTML = `
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Reddit+Sans:wght@400;500;600;700&family=JetBrains+Mono&family=Crimson+Pro:wght@700&display=swap');
          
          .pdf-content { 
            font-family: 'Reddit Sans', sans-serif; 
            color: #1c1917; 
            line-height: 1.6; 
            font-size: 11pt;
            padding: 0;
            width: 100%;
          }
          
          .pdf-content h1 { 
            font-family: 'Crimson Pro', serif;
            font-size: 32pt; 
            font-weight: 700; 
            margin-top: 0;
            margin-bottom: 24pt; 
            color: #0c0a09;
            line-height: 1.1;
            letter-spacing: -0.02em;
          }
          
          .pdf-content h2 { 
            font-family: 'Crimson Pro', serif;
            font-size: 22pt; 
            font-weight: 700; 
            margin-top: 36pt; 
            margin-bottom: 16pt; 
            color: #1c1917;
            border-bottom: 1px solid #e7e5e4;
            padding-bottom: 8pt;
          }
          
          .pdf-content h3 { 
            font-size: 16pt; 
            font-weight: 600; 
            margin-top: 24pt; 
            margin-bottom: 12pt; 
            color: #44403c;
          }
          
          .pdf-content p { 
            margin-bottom: 14pt; 
            orphans: 3;
            widows: 3;
          }
          
          .pdf-content ul, .pdf-content ol { 
            margin-bottom: 14pt; 
            padding-left: 24pt;
          }
          
          .pdf-content li { 
            margin-bottom: 6pt; 
          }
          
          .pdf-content code { 
            background-color: #f5f5f4; 
            padding: 2pt 4pt; 
            border-radius: 3pt; 
            font-family: 'JetBrains Mono', monospace; 
            font-size: 9pt;
            color: #57534e;
          }
          
          .pdf-content pre { 
            background-color: #f5f5f4; 
            padding: 16pt; 
            border-radius: 8pt; 
            margin-bottom: 20pt;
            font-family: 'JetBrains Mono', monospace; 
            font-size: 9pt;
            white-space: pre-wrap;
            border: 1px solid #e7e5e4;
            color: #292524;
          }
          
          .pdf-content blockquote { 
            border-left: 4pt solid #d6d3d1; 
            padding-left: 20pt; 
            margin-bottom: 20pt;
            font-style: italic; 
            color: #57534e; 
            background-color: #fafaf9;
            padding-top: 12pt;
            padding-bottom: 12pt;
            border-radius: 0 8pt 8pt 0;
          }
          
          .pdf-content img { 
            max-width: 100%; 
            height: auto; 
            margin: 24pt 0;
            border-radius: 12pt;
            display: block;
            box-shadow: 0 4pt 12pt rgba(0,0,0,0.05);
          }
          
          .pdf-content table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20pt;
            font-size: 10pt;
          }
          
          .pdf-content th, .pdf-content td {
            border: 1px solid #e7e5e4;
            padding: 12pt;
            text-align: left;
          }
          
          .pdf-content th {
            background-color: #f5f5f4;
            font-weight: 600;
            color: #1c1917;
          }

          .pdf-content hr {
            border: 0;
            border-top: 1px solid #e7e5e4;
            margin: 32pt 0;
          }

          /* Prevent elements from breaking across pages where possible */
          .pdf-content h1, .pdf-content h2, .pdf-content h3 {
            page-break-after: avoid;
          }
          .pdf-content pre, .pdf-content blockquote, .pdf-content img, .pdf-content table {
            page-break-inside: avoid;
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
      await new Promise(resolve => setTimeout(resolve, 1000));

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
          margin: [1, 0.75, 1, 0.75], // Top, Left, Bottom, Right
          autoPaging: 'text',
          x: 0,
          y: 0,
          width: 7, // 8.5 - (0.75 * 2)
          windowWidth: 672, // 7 * 96
          html2canvas: {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff'
          },
          callback: function (doc: jsPDF) {
            try {
              console.info('[mdToPdf] Adding page numbers and footer...');
              const pageCount = doc.getNumberOfPages();
              for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(9);
                doc.setTextColor(168, 162, 158); // stone-400
                
                // Footer
                doc.text(
                  `Page ${i} of ${pageCount}`, 
                  4.25, 10.5, 
                  { align: 'center' }
                );
                
                doc.text(
                  'Generated by MarkFlow', 
                  0.75, 10.5, 
                  { align: 'left' }
                );
              }

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

  async mdToDocx(md: string, filename: string, flavor: MarkdownFlavor = 'auto'): Promise<void> {
    console.info('[mdToDocx] Starting DOCX conversion process...');
    try {
      console.info('[mdToDocx] Lexing Markdown...');
      // We use the local library for mdToDocx because generating a valid .docx file
      // via an LLM is error-prone and often results in corrupted files.
      // The local library is much more robust for this specific task.
      const tokens = marked.lexer(md, { gfm: flavor !== 'commonmark' });
      const children: (Paragraph | Table)[] = [];

    interface MarkdownToken {
      type: string;
      text?: string;
      tokens?: MarkdownToken[];
      depth?: number;
      items?: { tokens?: MarkdownToken[] }[];
      ordered?: boolean;
      header?: { tokens: MarkdownToken[] }[];
      rows?: { tokens: MarkdownToken[] }[][];
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
        
        const paragraphOptions: IParagraphOptions = {
          children: processInline(token.tokens || []),
          heading: level,
          ...(token.depth === 2 ? {
            border: {
              bottom: {
                color: 'E7E5E4',
                space: 8,
                style: BorderStyle.SINGLE,
                size: 6,
              },
            }
          } : {})
        };
        
        children.push(new Paragraph(paragraphOptions));
      } else if (token.type === 'paragraph') {
        children.push(new Paragraph({
          children: processInline(token.tokens || []),
          style: 'Normal'
        }));
      } else if (token.type === 'code') {
        children.push(new Paragraph({
          children: [new TextRun({ text: token.text || '' })],
          style: 'CodeBlock',
          shading: {
            fill: 'F5F5F4',
          }
        }));
      } else if (token.type === 'blockquote') {
        children.push(new Paragraph({
          children: processInline(token.tokens || [], { italics: true }),
          style: 'Blockquote',
          border: {
            left: {
              color: 'D6D3D1',
              space: 20,
              style: BorderStyle.SINGLE,
              size: 24,
            },
          },
        }));
      } else if (token.type === 'hr') {
        children.push(new Paragraph({
          border: {
            bottom: { color: 'E7E5E4', space: 1, style: BorderStyle.SINGLE, size: 6 }
          },
          spacing: { before: 480, after: 480 }
        }));
      } else if (token.type === 'table') {
        const tableRows = [];
        // Header row
        if (token.header) {
          tableRows.push(new TableRow({
            children: token.header.map(cell => new TableCell({
              children: [new Paragraph({ children: processInline(cell.tokens) })],
              shading: { fill: 'F5F5F4' },
              margins: { top: 120, bottom: 120, left: 120, right: 120 }
            }))
          }));
        }
        // Data rows
        if (token.rows) {
          for (const row of token.rows) {
            tableRows.push(new TableRow({
              children: row.map(cell => new TableCell({
                children: [new Paragraph({ children: processInline(cell.tokens) })],
                margins: { top: 120, bottom: 120, left: 120, right: 120 }
              }))
            }));
          }
        }
        children.push(new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E7E5E4' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E7E5E4' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E7E5E4' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E7E5E4' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E7E5E4' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E7E5E4' },
          }
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
      styles: {
        default: {
          heading1: {
            run: {
              size: 64, // 32pt
              bold: true,
              color: '0C0A09',
              font: 'Calibri',
            },
            paragraph: {
              spacing: { before: 480, after: 480 },
            },
          },
          heading2: {
            run: {
              size: 44, // 22pt
              bold: true,
              color: '1C1917',
              font: 'Calibri',
            },
            paragraph: {
              spacing: { before: 720, after: 320 },
            },
          },
          heading3: {
            run: {
              size: 32, // 16pt
              bold: true,
              color: '44403C',
              font: 'Calibri',
            },
            paragraph: {
              spacing: { before: 480, after: 240 },
            },
          },
        },
        paragraphStyles: [
          {
            id: 'Normal',
            name: 'Normal',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: {
              size: 22, // 11pt
              color: '1C1917',
              font: 'Calibri',
            },
            paragraph: {
              spacing: { line: 360, after: 280 }, // 1.5 line spacing, 14pt after
            },
          },
          {
            id: 'CodeBlock',
            name: 'Code Block',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              size: 18, // 9pt
              font: 'Courier New',
              color: '292524',
            },
            paragraph: {
              spacing: { before: 240, after: 240 },
              indent: { left: 720 },
            },
          },
          {
            id: 'Blockquote',
            name: 'Blockquote',
            basedOn: 'Normal',
            next: 'Normal',
            run: {
              italics: true,
              color: '57534E',
            },
            paragraph: {
              spacing: { before: 240, after: 240 },
              indent: { left: 720 },
            },
          },
        ],
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              right: 1080, // 0.75 inch
              bottom: 1440,
              left: 1080,
            },
          },
        },
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

  async docxToMd(file: File, flavor: MarkdownFlavor = 'auto'): Promise<string> {
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
        contents: `Convert the following HTML extracted from a Word document into clean, well-formatted Markdown using ${flavor === 'auto' ? 'GitHub Flavored Markdown' : flavor} syntax. Preserve headings, lists, bold, italics, and links. Do not include any conversational text, just output the Markdown.\n\nHTML:\n${html}`,
      });
      
      console.info('[docxToMd] AI conversion completed successfully.');
      return response.text || this.getTurndownService(flavor).turndown(html);
    } catch (error) {
      console.error('[docxToMd] Fatal DOCX to MD Conversion Error:', error);
      throw new Error(`Failed to convert DOCX to MD: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async pdfToMd(file: File, flavor: MarkdownFlavor = 'auto'): Promise<string> {
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
              text: `Extract the text from this PDF and format it as clean Markdown using ${flavor === 'auto' ? 'GitHub Flavored Markdown' : flavor} syntax. Preserve the structure, headings, lists, and paragraphs. Do not include any conversational text, just output the Markdown.`
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

  async toPlainText(content: string | File): Promise<string> {
    console.info('[toPlainText] Converting to plain text...');
    try {
      if (typeof content === 'string') {
        // Use marked to parse to HTML then extract text content for reliable stripping
        const html = await this.mdToHtml(content);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        return tempDiv.textContent || tempDiv.innerText || '';
      } else {
        const file = content;
        if (file.name.endsWith('.docx')) {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          return result.value;
        } else if (file.name.endsWith('.pdf')) {
          // For PDF to text, we can use AI for better extraction or just return the markdown version stripped
          const md = await this.pdfToMd(file);
          return md.replace(/[#*`_~[\]()]/g, '');
        } else if (file.name.endsWith('.html')) {
          const html = await file.text();
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;
          return tempDiv.textContent || tempDiv.innerText || '';
        } else {
          return await file.text();
        }
      }
    } catch (error) {
      console.error('[toPlainText] Error converting to plain text:', error);
      throw new Error(`Failed to convert to plain text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
