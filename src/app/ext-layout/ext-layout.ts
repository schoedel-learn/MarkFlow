import { ChangeDetectionStrategy, Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CoreStateService } from '../core-state';
import { MatIconModule } from '@angular/material/icon';
import { MarkdownFlavor } from '../converter.service';

declare const chrome: any;

type ExtTab = 'page' | 'file';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-ext-layout',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './ext-layout.html',
  styleUrl: '../app.css', // We can share the Tailwind classes
})
export class ExtLayoutComponent {
  public state = inject(CoreStateService);
  
  activeTab = signal<ExtTab>('page');
  isExtractingPage = signal<boolean>(false);
  
  setTab(tab: ExtTab) {
    this.activeTab.set(tab);
    this.state.reset(); // Clear any previous errors or file selections
  }

  setFlavor(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.state.markdownFlavor.set(select.value as MarkdownFlavor);
  }

  async extractCurrentPage() {
    this.isExtractingPage.set(true);
    this.state.error.set(null);
    
    try {
      // In a real extension environment, we query the active tab and extract its HTML.
      // For now, this is a placeholder indicating where the chrome.scripting API will go.
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.id) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML
          });
          
          if (results && results[0] && results[0].result) {
            const html = results[0].result;
            // Create a fake file to pass to the state service
            const htmlFile = new File([html], 'webpage.html', { type: 'text/html' });
            this.state.selectedFile.set(htmlFile);
            
            // Re-use the existing logic to convert to Markdown
            await this.state.convertToMarkdown({});
            return;
          }
        }
      }
      throw new Error("Cannot access page context. Are you running as a Chrome Extension?");
    } catch (e: any) {
      this.state.error.set(e.message || "Failed to extract page.");
    } finally {
      this.isExtractingPage.set(false);
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.state.selectedFile.set(file);
    this.state.error.set(null);
  }

  // Trigger file input dialog
  triggerFileInput() {
    document.getElementById('ext-file-upload')?.click();
  }
}
