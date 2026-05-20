import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'markflow-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** User's stored preference. 'auto' means follow the browser. */
  readonly preference = signal<ThemePreference>('auto');
  /** What the page is actually showing right now. */
  readonly resolved = signal<ResolvedTheme>('dark');

  private mediaQuery: MediaQueryList | null = null;
  private mediaListener: ((event: MediaQueryListEvent) => void) | null = null;

  constructor() {
    if (!this.isBrowser) return;

    const stored = window.localStorage.getItem(STORAGE_KEY);
    const pref: ThemePreference =
      stored === 'light' || stored === 'dark' ? stored : 'auto';
    this.preference.set(pref);
    this.apply(pref);
  }

  setPreference(pref: ThemePreference) {
    this.preference.set(pref);
    if (!this.isBrowser) return;
    if (pref === 'auto') {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, pref);
    }
    this.apply(pref);
  }

  /** Cycle auto -> light -> dark -> auto. */
  cycle() {
    const order: ThemePreference[] = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(this.preference()) + 1) % order.length];
    this.setPreference(next);
  }

  private apply(pref: ThemePreference) {
    if (!this.isBrowser) return;
    const resolved = pref === 'auto' ? this.systemTheme() : pref;
    this.resolved.set(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
    this.watchSystem(pref === 'auto');
  }

  private systemTheme(): ResolvedTheme {
    // Default to dark when there is no expressed preference.
    if (!window.matchMedia) return 'dark';
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }

  private watchSystem(enable: boolean) {
    if (!this.isBrowser || !window.matchMedia) return;
    if (!this.mediaQuery) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    }
    if (this.mediaListener) {
      this.mediaQuery.removeEventListener('change', this.mediaListener);
      this.mediaListener = null;
    }
    if (enable) {
      this.mediaListener = () => this.apply('auto');
      this.mediaQuery.addEventListener('change', this.mediaListener);
    }
  }
}
