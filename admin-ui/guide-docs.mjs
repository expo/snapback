// Manifest-driven Snapback Guide projection for the admin console.
//
// @exact/markdown is source-only in the sibling Exact workspace and is not a
// supported dependency of the published admin package set. LLP 0061 Phase 3
// therefore calls for pattern reuse with the console's own machinery. This
// module deliberately emits scalar text blocks: no HTML parsing, innerHTML, or
// dynamic component source crosses the served-markdown boundary.
//
// @ref LLP 0061#plan — the console consumes the
// served, build-matched guide manifest and renders the same corpus read-only.

const GUIDE_SCHEMA_VERSION = 'snapback-guide.v1';

export async function loadGuideCatalog(client) {
  const { manifest, identity } = await client.guideManifest();
  if (!manifest || manifest.schemaVersion !== GUIDE_SCHEMA_VERSION) {
    throw guideError(
      'SNAPBACK_GUIDE_MANIFEST_UNSUPPORTED',
      `expected ${GUIDE_SCHEMA_VERSION}, got ${String(manifest?.schemaVersion ?? 'missing')}`,
    );
  }
  if (!manifest.pages || typeof manifest.pages !== 'object' || Array.isArray(manifest.pages)) {
    throw guideError('SNAPBACK_GUIDE_MANIFEST_INVALID', 'guide manifest has no pages object');
  }

  const pagesByPath = new Map();
  for (const [id, page] of Object.entries(manifest.pages)) {
    const path = servedPath(page?.path);
    if (!path || typeof page?.title !== 'string') {
      throw guideError('SNAPBACK_GUIDE_MANIFEST_INVALID', `guide page ${id} has an invalid path or title`);
    }
    pagesByPath.set(path, { id, path, title: page.title });
  }

  const groups = [];
  for (const [directory, entries] of Object.entries(manifest.nav || {})) {
    const items = [];
    for (const entry of entries || []) {
      const page = manifest.pages[entry.id];
      const path = servedPath(page?.path);
      if (path && pagesByPath.has(path)) {
        items.push({ key: entry.id, path, title: entry.title });
      }
    }
    if (items.length > 0) {
      groups.push({
        key: directory,
        label: directory === '.' ? 'Guide' : titleCase(directory),
        items,
      });
    }
  }

  const initialPath = pagesByPath.has('index.md')
    ? 'index.md'
    : groups[0]?.items[0]?.path;
  if (!initialPath) {
    throw guideError('SNAPBACK_GUIDE_MANIFEST_INVALID', 'guide manifest contains no navigable pages');
  }

  return {
    manifest,
    identity,
    groups,
    pagesByPath,
    initialPath,
  };
}

export async function loadGuidePage(client, catalog, requestedPath) {
  const path = String(requestedPath || catalog.initialPath);
  const page = catalog.pagesByPath.get(path);
  if (!page) {
    throw guideError('SNAPBACK_GUIDE_PAGE_UNKNOWN', `guide manifest does not declare ${path}`);
  }
  const markdown = await client.guidePage(path, catalog.identity);
  const blocks = parseGuideMarkdown(markdown);
  if (blocks[0]?.kind === 'heading' && blocks[0].text === page.title) blocks.shift();
  for (const [index, block] of blocks.entries()) block.key = `b${index}`;
  return {
    id: 'guide-page',
    loading: false,
    hasError: false,
    error: '',
    currentPath: path,
    title: page.title,
    identityLabel: `${shortHash(catalog.identity.contentHash)} · ${shortHash(catalog.identity.buildCommit)}`,
    rawHref: `/_snapback/guide/${path}`,
    groups: catalog.groups,
    hasGroups: catalog.groups.length > 0,
    blocks,
  };
}

export function loadingGuidePage(current, path) {
  let page = null;
  for (const group of current?.groups || []) {
    page = (group.items || []).find((item) => item.path === path) || null;
    if (page) break;
  }
  return {
    ...(current || emptyGuidePage()),
    loading: true,
    hasError: false,
    error: '',
    currentPath: path,
    title: page?.title || current?.title || 'Snapback Guide',
    blocks: [],
  };
}

export function failedGuidePage(error, current = null) {
  return {
    ...(current || emptyGuidePage()),
    loading: false,
    hasError: true,
    error: errorMessage(error),
    blocks: [],
  };
}

export function parseGuideMarkdown(markdown) {
  const lines = stripFrontmatter(String(markdown ?? '')).split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let fenced = null;

  const push = (kind, text, extras = {}) => {
    if (!text && kind !== 'rule') return;
    blocks.push({ key: `b${blocks.length}`, kind, text, ...extras });
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    push('paragraph', inlineText(paragraph.join(' ')));
    paragraph = [];
  };

  for (const line of lines) {
    if (fenced) {
      if (/^\s*```/.test(line)) {
        push('code', fenced.lines.join('\n'), { label: fenced.label || 'code' });
        fenced = null;
      } else {
        fenced.lines.push(line);
      }
      continue;
    }

    const fence = line.match(/^\s*```([^\s]*)/);
    if (fence) {
      flushParagraph();
      fenced = { label: fence[1], lines: [] };
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      push('heading', inlineText(heading[2]), {
        level,
        size: level === 1 ? 24 : level === 2 ? 19 : 15,
      });
      continue;
    }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(line)) {
      flushParagraph();
      push('rule', '');
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      push('quote', inlineText(quote[1]));
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      push('list', inlineText(unordered[1]), { marker: '•' });
      continue;
    }
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      push('list', inlineText(ordered[2]), { marker: `${ordered[1]}.` });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      const prior = blocks[blocks.length - 1];
      if (prior?.kind === 'table') {
        prior.text += `\n${line.trim()}`;
      } else {
        push('table', line.trim(), { label: 'table' });
      }
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  if (fenced) push('code', fenced.lines.join('\n'), { label: fenced.label || 'code' });
  return blocks;
}

function emptyGuidePage() {
  return {
    id: 'guide-page',
    loading: false,
    hasError: false,
    error: '',
    currentPath: '',
    title: 'Snapback Guide',
    identityLabel: '',
    rawHref: '/_snapback/guide',
    groups: [],
    hasGroups: false,
    blocks: [],
  };
}

function servedPath(path) {
  if (typeof path !== 'string' || !path.startsWith('guide/')) return null;
  const relative = path.slice('guide/'.length);
  if (!relative || relative.includes('..') || !/^[A-Za-z0-9._/-]+\.md$/.test(relative)) return null;
  return relative;
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) return markdown;
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return match ? markdown.slice(match[0].length) : markdown;
}

function inlineText(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

function titleCase(value) {
  return String(value)
    .split(/[-_]/)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
}

function shortHash(value) {
  const text = String(value || 'unknown');
  return text.length > 12 ? text.slice(0, 12) : text;
}

function guideError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message };
  return error;
}

function errorMessage(error) {
  if (error && typeof error === 'object' && error.diagnostic?.code) {
    return `${error.diagnostic.code}: ${error.diagnostic.message || error.message || ''}`;
  }
  return error instanceof Error ? error.message : String(error ?? 'guide unavailable');
}
