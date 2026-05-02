declare const GEMINI_API_KEY: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Buffer: any;

declare module 'turndown-plugin-gfm';

interface Window {
  aistudio?: {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  };
}
