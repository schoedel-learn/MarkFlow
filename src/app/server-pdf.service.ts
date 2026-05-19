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

export interface BackendKeyStatus {
  hasKey: boolean;
  updatedAt: string | null;
}

export type ApprovedPdfJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ApprovedPdfJob {
  jobId: string;
  status: ApprovedPdfJobStatus;
  originalFilename?: string;
  flavor?: string;
  storageInputPath?: string;
  storageOutputPath?: string;
  errorMessage?: string;
  updatedAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServerPdfService {
  private readonly apiBaseUrl = environment.apiBaseUrl;

  private async getAuthorizedHeaders(): Promise<HeadersInit> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('You must be signed in to use server-managed PDF conversion.');
    }

    const idToken = await currentUser.getIdToken();
    return {
      Authorization: `Bearer ${idToken}`,
    };
  }

  private async parseResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
    const data = await response.json() as T | ErrorResponse;
    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null && 'detail' in data
        ? (data as ErrorResponse).detail
        : undefined;
      throw new Error(detail || fallbackMessage);
    }

    return data as T;
  }

  async convertApprovedPdfSync(file: File, flavor: MarkdownFlavor): Promise<string> {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('You must be signed in to use server-managed PDF conversion.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_email', currentUser.email ?? '');
    formData.append('flavor', flavor);

    const response = await fetch(`${this.apiBaseUrl}/convert/pdf/approved-sync`, {
      method: 'POST',
      headers: await this.getAuthorizedHeaders(),
      body: formData,
    });

    const data = await this.parseResponse<MarkdownResponse>(response, 'Server-managed PDF conversion failed.');

    if (!('markdown' in data) || typeof data.markdown !== 'string') {
      throw new Error('Server-managed PDF conversion returned an invalid response.');
    }

    return data.markdown;
  }

  async createApprovedPdfJob(file: File, flavor: MarkdownFlavor): Promise<ApprovedPdfJob> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('flavor', flavor);

    const response = await fetch(`${this.apiBaseUrl}/jobs/pdf`, {
      method: 'POST',
      headers: await this.getAuthorizedHeaders(),
      body: formData,
    });

    return this.parseResponse<ApprovedPdfJob>(response, 'Failed to queue server-managed PDF conversion.');
  }

  async getApprovedPdfJob(jobId: string): Promise<ApprovedPdfJob> {
    const response = await fetch(`${this.apiBaseUrl}/jobs/pdf/${jobId}`, {
      method: 'GET',
      headers: await this.getAuthorizedHeaders(),
    });

    return this.parseResponse<ApprovedPdfJob>(response, 'Failed to fetch PDF conversion job status.');
  }

  async getApprovedPdfMarkdown(jobId: string): Promise<string> {
    const response = await fetch(`${this.apiBaseUrl}/jobs/pdf/${jobId}/markdown`, {
      method: 'GET',
      headers: await this.getAuthorizedHeaders(),
    });

    const data = await this.parseResponse<MarkdownResponse>(response, 'Failed to fetch completed PDF markdown.');
    if (!('markdown' in data) || typeof data.markdown !== 'string') {
      throw new Error('Completed PDF job returned an invalid markdown payload.');
    }

    return data.markdown;
  }

  async pollApprovedPdfJob(
    jobId: string,
    options: { maxAttempts?: number; intervalMs?: number } = {},
  ): Promise<ApprovedPdfJob> {
    const maxAttempts = options.maxAttempts ?? 12;
    const intervalMs = options.intervalMs ?? 5000;

    let latestJob = await this.getApprovedPdfJob(jobId);
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      if (latestJob.status === 'completed' || latestJob.status === 'failed') {
        return latestJob;
      }

      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
      latestJob = await this.getApprovedPdfJob(jobId);
    }

    return latestJob;
  }

  async getBackendKeyStatus(): Promise<BackendKeyStatus> {
    const response = await fetch(`${this.apiBaseUrl}/me/gemini-key`, {
      method: 'GET',
      headers: await this.getAuthorizedHeaders(),
    });
    return this.parseResponse<BackendKeyStatus>(response, 'Failed to load backend API key status.');
  }

  async setBackendKey(geminiKey: string): Promise<BackendKeyStatus> {
    const headers = {
      ...(await this.getAuthorizedHeaders()),
      'Content-Type': 'application/json',
    };
    const response = await fetch(`${this.apiBaseUrl}/me/gemini-key`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ geminiKey }),
    });
    return this.parseResponse<BackendKeyStatus>(response, 'Failed to save backend API key.');
  }

  async clearBackendKey(): Promise<BackendKeyStatus> {
    const response = await fetch(`${this.apiBaseUrl}/me/gemini-key`, {
      method: 'DELETE',
      headers: await this.getAuthorizedHeaders(),
    });
    return this.parseResponse<BackendKeyStatus>(response, 'Failed to clear backend API key.');
  }
}