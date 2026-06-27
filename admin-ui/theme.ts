// Self-contained palette + font stack + tab list for the admin console.
//
// Plain helpers the `.contract` `use`s (the labs pull these from
// @exact/facet-contract; we keep a dependency-free light palette so the static
// build stays lean — dark mode via facet is a follow-up). Aesthetic matches the
// embedded console: indigo accent, hairline borders.

export interface AdminColors {
  readonly bg: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly accentText: string;
  readonly ok: string;
  readonly okSoft: string;
  readonly warn: string;
  readonly warnSoft: string;
  readonly err: string;
  readonly errSoft: string;
}

export function colors(): AdminColors {
  return {
    bg: '#f5f6f8',
    surface: '#ffffff',
    surfaceRaised: '#fafbfc',
    border: '#e3e5ea',
    borderStrong: '#d4d7df',
    text: '#1c1d21',
    textMuted: '#6b7280',
    textFaint: '#9aa1ad',
    accent: '#5e6ad2',
    accentSoft: '#eceefb',
    accentText: '#4954c8',
    ok: '#2a8447',
    okSoft: '#e7f3ea',
    warn: '#b25e09',
    warnSoft: '#fbf0e2',
    err: '#c0362c',
    errSoft: '#fbeae8',
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

export function tabNames(): string[] {
  return ['Overview', 'Schema', 'Data', 'Functions', 'Realtime', 'Diagnostics'];
}

// Initial tab from the URL hash (e.g. /_snapback/admin#Functions), so a view is
// deep-linkable; defaults to Overview. Guards for non-DOM hosts.
export function initialTab(): string {
  if (typeof location === 'undefined' || !location.hash) return 'Overview';
  const tab = decodeURIComponent(location.hash.slice(1));
  return tabNames().includes(tab) ? tab : 'Overview';
}
