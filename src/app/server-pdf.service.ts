import { Injectable } from '@angular/core';

import { auth } from './firebase';
import { environment } from '../environments/environment';
import { MarkdownFlavor } from './converter.service';

interface MarkdownResponse {
  markdown: string;
}

interface ErrorResponse {
  detail?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServerPdfService {
  private readonly apiBaseUrl = environment.apiBaseUrl;

  async convertApprovedPdfSync(file: File, flavor: MarkdownFlavor): Promise<string> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('You must be signed in to use server-managed PDF conversion.');
    }

    const idToken = await currentUser.getIdToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_email', currentUser.email ?? '');
    formData.append('flavor', flavor);

    const response = await fetch(`${this.apiBaseUrl}/convert/pdf/approved-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      body: formData,
    });

    const data = await response.json() as MarkdownResponse | ErrorResponse;
    if (!response.ok) {
      const detail = 'detail' in data ? data.detail : undefined;
      throw new Error(detail || 'Server-managed PDF conversion failed.');
    }

    if (!('markdown' in data) || typeof data.markdown !== 'string') {
      throw new Error('Server-managed PDF conversion returned an invalid response.');
    }

    return data.markdown;
  }
}