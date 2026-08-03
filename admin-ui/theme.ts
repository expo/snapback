// Design system for the Snapback admin console.
//
// Plain dependency-free helpers the `.contract` `use`s. Two hand-tuned palettes
// (light + dark) selected by the host/system color scheme, a shared font stack,
// and the nav model. Dark mode is real here (no @exact/facet-contract
// dependency): the resolved palette is threaded through the view as the `c`
// value and passed to child components as a prop, so host appearance changes
// re-render everything.
//
// @ref LLP 0017#console-surfaces — the console is a system app over the headless
//   admin contract; this file owns only presentation tokens, never admin facts.

export interface AdminColors {
  readonly scheme: string;
  // Surfaces
  readonly canvas: string; // app background behind the content pane
  readonly sidebar: string; // sidebar background
  readonly surface: string; // cards, panels
  readonly surfaceRaised: string; // table headers, code blocks, inset wells
  readonly surfaceHover: string; // subtle row/selection wash
  // Lines
  readonly border: string; // hairline
  readonly borderStrong: string; // inputs, stronger dividers
  // Ink
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly onAccent: string; // text on an accent fill
  // Accent
  readonly accent: string;
  readonly accentText: string;
  readonly accentSoft: string;
  // Status
  readonly ok: string;
  readonly okSoft: string;
  readonly warn: string;
  readonly warnSoft: string;
  readonly err: string;
  readonly errSoft: string;
  readonly info: string;
  readonly infoSoft: string;
  // Brand mark ink (the mark's knockout eyes/knob show the sidebar through)
  readonly markInk: string;
  // Elevation
  readonly shadowCard: string;
  readonly shadowSidebar: string;
}

const LIGHT: AdminColors = {
  scheme: 'light',
  canvas: '#f5f6f8',
  sidebar: '#ffffff',
  surface: '#ffffff',
  surfaceRaised: '#f7f8fa',
  surfaceHover: '#f0f1f5',
  border: '#e7e8ee',
  borderStrong: '#d7d9e1',
  text: '#16181d',
  textMuted: '#5b6473',
  textFaint: '#969ca9',
  onAccent: '#ffffff',
  accent: '#5b63d3',
  accentText: '#4a52c2',
  accentSoft: '#eceefb',
  ok: '#1f8b4c',
  okSoft: '#e6f4ea',
  warn: '#a96512',
  warnSoft: '#f9efdd',
  err: '#c23a30',
  errSoft: '#fbe9e6',
  info: '#4a52c2',
  infoSoft: '#eceefb',
  markInk: '#16181d',
  shadowCard: '0 1px 2px rgba(18, 20, 26, 0.04), 0 1px 3px rgba(18, 20, 26, 0.05)',
  shadowSidebar: '1px 0 0 rgba(18, 20, 26, 0.04)',
};

const DARK: AdminColors = {
  scheme: 'dark',
  canvas: '#0e0f13',
  sidebar: '#131419',
  surface: '#16181e',
  surfaceRaised: '#1c1f27',
  surfaceHover: '#20232c',
  border: '#262932',
  borderStrong: '#363a45',
  text: '#e8eaf0',
  textMuted: '#9aa1b1',
  textFaint: '#6a7180',
  onAccent: '#ffffff',
  accent: '#7e86ee',
  accentText: '#aab0f7',
  accentSoft: '#20233a',
  ok: '#56c878',
  okSoft: '#16271d',
  warn: '#d9a13d',
  warnSoft: '#2c2316',
  err: '#e5736a',
  errSoft: '#2e1b19',
  info: '#aab0f7',
  infoSoft: '#20233a',
  markInk: '#e8eaf0',
  shadowCard: '0 1px 2px rgba(0, 0, 0, 0.28), 0 1px 3px rgba(0, 0, 0, 0.34)',
  shadowSidebar: '1px 0 0 rgba(0, 0, 0, 0.3)',
};

export function colors(mode?: string): AdminColors {
  return mode === 'dark' ? DARK : LIGHT;
}

type AdminThemeMode = 'light' | 'dark';
type ThemeListener = (mode: AdminThemeMode) => void;
type MediaQueryListLike = {
  readonly matches: boolean;
  addEventListener?: (event: 'change', listener: () => void) => void;
  removeEventListener?: (event: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};
type ExactAccessibilityLike = {
  readonly colorScheme?: AdminThemeMode;
  addEventListener?: (event: string, listener: () => void) => unknown;
};
type ExactGlobal = {
  readonly Exact?: {
    readonly accessibility?: ExactAccessibilityLike;
  };
  readonly __exactAppearanceState?: {
    readonly colorScheme?: AdminThemeMode;
  };
  readonly __exactAccessibilitySnapshot?: {
    readonly colorScheme?: AdminThemeMode;
  };
  __exactWindowNotifyMediaChange?: (next: { colorScheme?: AdminThemeMode; reducedMotion?: boolean }) => void;
  matchMedia?: (query: string) => MediaQueryListLike;
};

export function systemTheme(): AdminThemeMode {
  return readSystemTheme();
}

export function watchSystemTheme(listener: ThemeListener): () => void {
  let last = readSystemTheme();
  let disposed = false;
  const disposers: Array<() => void> = [];
  const sync = () => {
    if (disposed) return;
    const next = readSystemTheme();
    if (next !== last) {
      last = next;
      listener(next);
    }
  };

  const media = darkModeMediaQuery();
  if (media) {
    if (typeof media.addEventListener === 'function' && typeof media.removeEventListener === 'function') {
      media.addEventListener('change', sync);
      disposers.push(() => media.removeEventListener?.('change', sync));
    } else if (typeof media.addListener === 'function' && typeof media.removeListener === 'function') {
      media.addListener(sync);
      disposers.push(() => media.removeListener?.(sync));
    }
  }

  const accessibility = exactAccessibility();
  if (accessibility && typeof accessibility.addEventListener === 'function') {
    for (const event of ['colorSchemeChanged', 'change']) {
      const cleanup = accessibility.addEventListener(event, sync);
      if (typeof cleanup === 'function') {
        disposers.push(cleanup as () => void);
      }
    }
  }

  const globals = globalThis as ExactGlobal;
  const previousNativeNotify = globals.__exactWindowNotifyMediaChange;
  if (previousNativeNotify || globals.__exactAppearanceState || globals.__exactAccessibilitySnapshot) {
    const chainedNotify: ExactGlobal['__exactWindowNotifyMediaChange'] = (next) => {
      previousNativeNotify?.(next);
      sync();
    };
    globals.__exactWindowNotifyMediaChange = chainedNotify;
    disposers.push(() => {
      if (globals.__exactWindowNotifyMediaChange === chainedNotify) {
        globals.__exactWindowNotifyMediaChange = previousNativeNotify;
      }
    });
  }

  sync();

  return () => {
    disposed = true;
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {
        // Ignore host listener cleanup failures.
      }
    }
  };
}

export interface AdminFonts {
  readonly sans: string;
  readonly mono: string;
}

export function fonts(): AdminFonts {
  return {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  };
}

// The console surfaces, in nav order. `key` is the routing/hash token; `label`
// is what the sidebar shows; `glyph` is a tiny monochrome mark drawn in the nav.
export interface NavSection {
  readonly key: string;
  readonly label: string;
}

export function navSections(): NavSection[] {
  return [
    { key: 'Overview', label: 'Overview' },
    { key: 'Health', label: 'Health' },
    { key: 'Errors', label: 'Errors' },
    { key: 'Logs', label: 'Logs' },
    { key: 'Schema', label: 'Schema' },
    { key: 'Data', label: 'Data' },
    { key: 'Functions', label: 'Functions' },
    { key: 'Secrets', label: 'Secrets' },
    { key: 'Capabilities', label: 'Capabilities' },
    { key: 'Realtime', label: 'Realtime' },
    { key: 'Diagnostics', label: 'Diagnostics' },
    { key: 'Docs', label: 'Docs' },
  ];
}

export function tabNames(): string[] {
  return navSections().map((s) => s.key);
}

// Initial tab from the URL hash (e.g. /_snapback/admin#Functions), so a view is
// deep-linkable. Defaults to Overview. Guards for non-DOM hosts.
export function initialTab(): string {
  if (typeof location === 'undefined' || !location.hash) return 'Overview';
  let tab = location.hash.slice(1);
  try {
    tab = decodeURIComponent(tab);
  } catch {
    return 'Overview';
  }
  return tabNames().includes(tab) ? tab : 'Overview';
}

function readSystemTheme(): AdminThemeMode {
  const globals = globalThis as ExactGlobal;
  const exactAppearanceScheme = globals.__exactAppearanceState?.colorScheme;
  if (exactAppearanceScheme === 'dark' || exactAppearanceScheme === 'light') {
    return exactAppearanceScheme;
  }

  const media = darkModeMediaQuery();
  if (media) {
    return media.matches ? 'dark' : 'light';
  }

  const exactAccessibilityScheme = globals.__exactAccessibilitySnapshot?.colorScheme;
  if (exactAccessibilityScheme === 'dark' || exactAccessibilityScheme === 'light') {
    return exactAccessibilityScheme;
  }

  const accessibilityScheme = exactAccessibility()?.colorScheme;
  if (accessibilityScheme === 'dark' || accessibilityScheme === 'light') {
    return accessibilityScheme;
  }

  return 'light';
}

function exactAccessibility(): ExactAccessibilityLike | null {
  const accessibility = (globalThis as ExactGlobal).Exact?.accessibility;
  return accessibility && typeof accessibility === 'object' ? accessibility : null;
}

function darkModeMediaQuery(): MediaQueryListLike | null {
  try {
    return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  } catch {
    return null;
  }
}
