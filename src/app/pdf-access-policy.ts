export const PUBLIC_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const PUBLIC_PDF_MAX_PAGES = 25;
export const PUBLIC_PDF_CONTACT_EMAIL = 'barry@schoedeldesign.ai';

export interface PdfInspectionMetadata {
  pageCount: number;
  sizeBytes: number;
}

export function exceedsPublicPdfPolicy(metadata: PdfInspectionMetadata): boolean {
  return metadata.sizeBytes > PUBLIC_PDF_MAX_BYTES || metadata.pageCount > PUBLIC_PDF_MAX_PAGES;
}

export function buildPublicPdfLimitMessage(metadata?: Partial<PdfInspectionMetadata>): string {
  const reasons: string[] = [];

  if ((metadata?.sizeBytes ?? 0) > PUBLIC_PDF_MAX_BYTES) {
    reasons.push('it is larger than 10 MB');
  }

  if ((metadata?.pageCount ?? 0) > PUBLIC_PDF_MAX_PAGES) {
    reasons.push('it has more than 25 pages');
  }

  const detail = reasons.length > 0
    ? ` This file cannot be converted publicly because ${reasons.join(' and ')}.`
    : '';

  return `Public PDF-to-Markdown conversion is limited to 10 MB and 25 pages. Contact ${PUBLIC_PDF_CONTACT_EMAIL} for larger PDFs.${detail}`;
}