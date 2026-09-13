#!/usr/bin/env node
// Build the staged, self-contained documentation projection described by
// LLP 0195. This generator deliberately binds its public identity to the
// qualified published-closure record plus the Guide content digest, never to
// the repository commit at which the projection happened to run.
// @ref LLP 0195#proposal — public Guide projection identity, base-aware links,
// /llms.txt, and closure-fenced reference inclusion are generator-owned.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import {
  FLAT_PATH,
  DIAGNOSTICS_REGISTRY_PATH,
  MANIFEST_PATH,
  PUBLISHED_CLOSURE_PATH,
  SYMBOL_REGISTRY_PATH,
  buildFlatGuide,
  checkPublishedClosure,
  guideContentHash,
  listGuidePages,
  markdownAnchorPlan,
  parseFrontmatter,
  replaceMarkdownInlineLinks,
  repoRoot,
  validateFrontmatter,
} from './guide-lib.mjs';

const SITE_SCHEMA = 'snapback-docs-site.v1';
const SITE_DIGEST_DOMAIN = `${SITE_SCHEMA}\0content\0`;
const OUTPUT_DIRECTORY = 'docs-site-dist';
const SITE_MANIFEST_PATH = 'site-manifest.json';
const DEFAULT_PORT = 4173;
const LATEST_ALIAS_PATH = '/latest/';
const INTERNAL_STATIC_TARGETS = new Map([
  ['guide/frontmatter.schema.json', '/frontmatter.schema.json'],
  [PUBLISHED_CLOSURE_PATH, '/published-closure.json'],
  [SYMBOL_REGISTRY_PATH, '/reference/registry.json'],
  [DIAGNOSTICS_REGISTRY_PATH, '/reference/diagnostics-registry.json'],
  ['brand/snapback-mark.svg', '/assets/snapback-mark.svg'],
]);

function fail(message) {
  throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function normalizeBasePath(raw) {
  if (!raw.startsWith('/')) fail('--base must be an absolute URL path beginning with /');
  if (raw.includes('?') || raw.includes('#') || raw.includes('\\')) {
    fail('--base must be a URL path without a query, fragment, or backslash');
  }
  const segments = raw.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    fail('--base must not contain . or .. path segments');
  }
  if (segments.some((segment) => !/^[A-Za-z0-9._~-]+$/u.test(segment))) {
    fail('--base path segments may contain only URL-safe unescaped characters');
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}

function atBase(basePath, target) {
  if (!target.startsWith('/')) fail(`cannot apply base path to non-root target ${target}`);
  return basePath === '/' ? target : `${basePath.slice(0, -1)}${target}`;
}

function snapshotBasePath(closureVersion) {
  if (!/^\d+\.\d+\.\d+$/u.test(closureVersion)) {
    fail(`cannot derive a snapshot path from invalid closure version ${closureVersion}`);
  }
  return `/v/${closureVersion}/`;
}

function publicationRoutes(closureVersion, basePath) {
  const snapshot = snapshotBasePath(closureVersion);
  if (basePath.startsWith('/v/') && basePath !== snapshot) {
    fail(
      `versioned base ${basePath} does not match published closure ${closureVersion}; ` +
      `expected ${snapshot}`,
    );
  }
  return {
    policy: 'immutable-closure-snapshot-with-latest-alias',
    snapshot,
    latestAlias: LATEST_ALIAS_PATH,
    renderedBase: basePath,
    canonicalBase: snapshot,
    immutableSnapshot: basePath === snapshot,
  };
}

function parseArgs(argv) {
  const options = { check: false, serve: false, port: DEFAULT_PORT, basePath: '/' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      options.check = true;
    } else if (arg === '--serve') {
      options.serve = true;
    } else if (arg === '--port') {
      const raw = argv[i + 1];
      if (raw === undefined || !/^\d+$/u.test(raw)) fail('--port requires an integer from 0 through 65535');
      options.port = Number(raw);
      if (options.port > 65535) fail('--port requires an integer from 0 through 65535');
      i += 1;
    } else if (arg === '--base') {
      const raw = argv[i + 1];
      if (raw === undefined) fail('--base requires an absolute URL path');
      options.basePath = normalizeBasePath(raw);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/generate-docs-site.mjs [--check] [--serve] [--port N] [--base /path/]');
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (options.check && options.serve) fail('--check and --serve are mutually exclusive');
  return options;
}

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

// Static rendering consumes committed Guide bytes only. The broader shared
// loader also validates frontmatter authorities/examples, including ignored
// demo codegen products that are intentionally absent in a fresh checkout.
// Those execution-bearing joins remain owned by scripts/check-guide.mjs; this
// projection loader validates the authored metadata shape and exact bytes.
function loadProjectionCorpus(root) {
  const errors = [];
  const pagePaths = listGuidePages(root);
  const pageInfo = new Map();
  const pageBodies = new Map();
  for (const path of pagePaths) {
    const raw = readFileSync(join(root, path), 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw, path, errors);
    if (frontmatter) validateFrontmatter(frontmatter, path, errors);
    pageInfo.set(path, { frontmatter, raw });
    pageBodies.set(path, body);
  }
  return { errors, pagePaths, pageInfo, pageBodies };
}

function pageRoute(sourcePath, basePath) {
  const guideRelative = sourcePath.replace(/^guide\//u, '');
  if (guideRelative === 'index.md') return basePath;
  if (guideRelative.endsWith('/index.md')) {
    return atBase(basePath, `/${guideRelative.slice(0, -'index.md'.length)}`);
  }
  return atBase(basePath, `/${guideRelative.slice(0, -'.md'.length)}/`);
}

function routeOutputPath(route, basePath) {
  if (!route.startsWith('/') || !route.endsWith('/')) fail(`invalid page route ${route}`);
  if (!route.startsWith(basePath)) fail(`page route ${route} is outside base path ${basePath}`);
  const relativeRoute = route.slice(basePath.length);
  return relativeRoute === '' ? 'index.html' : `${relativeRoute}index.html`;
}

function splitTarget(value) {
  const hashAt = value.indexOf('#');
  return hashAt === -1
    ? { path: value, fragment: '' }
    : { path: value.slice(0, hashAt), fragment: value.slice(hashAt + 1) };
}

function repoPathForRelativeTarget(sourcePath, rawTarget) {
  const { path } = splitTarget(rawTarget.split('?')[0]);
  return normalize(join(dirname(sourcePath), path)).split(sep).join('/');
}

function makeLinkResolver({ routesBySource, sourcePath, basePath }) {
  return (rawTarget, { asset = false } = {}) => {
    const target = rawTarget.trim();
    if (/^(?:https?:|mailto:|tel:)/u.test(target)) {
      return { kind: asset ? 'forbidden-external-asset' : 'external', href: target };
    }
    if (target.startsWith('repo:') || /^repo\([^)]+\):/u.test(target)) {
      return { kind: 'source-only', label: target };
    }
    if (target.startsWith('#')) return { kind: 'internal', href: target };
    if (target.startsWith('/')) return { kind: 'internal', href: atBase(basePath, target) };

    const { fragment } = splitTarget(target);
    const repoPath = repoPathForRelativeTarget(sourcePath, target);
    if (repoPath.endsWith('.md')) {
      const route = routesBySource.get(repoPath);
      if (!route) return { kind: 'missing', label: target };
      return { kind: 'internal', href: `${route}${fragment ? `#${fragment}` : ''}` };
    }
    const staticRoute = INTERNAL_STATIC_TARGETS.get(repoPath);
    if (staticRoute) {
      return {
        kind: 'internal',
        href: `${atBase(basePath, staticRoute)}${fragment ? `#${fragment}` : ''}`,
      };
    }
    return { kind: 'source-only', label: repoPath };
  };
}

function storeInline(tokens, html) {
  const key = `\u0000INLINE${tokens.length}\u0000`;
  tokens.push(html);
  return key;
}

function renderInline(value, resolveLink) {
  const tokens = [];
  let rendered = escapeHtml(value);

  rendered = rendered.replace(/`([^`\n]+)`/gu, (_match, code) =>
    storeInline(tokens, `<code>${code}</code>`));

  rendered = replaceMarkdownInlineLinks(rendered, ({ image, label, target }) => {
    if (image) {
      const resolved = resolveLink(target, { asset: true });
      if (resolved.kind === 'forbidden-external-asset') {
        fail(`external network asset is forbidden in ${target}`);
      }
      if (resolved.kind !== 'internal') {
        return storeInline(tokens, `<span class="missing-asset">${label}</span>`);
      }
      return storeInline(tokens,
        `<img src="${escapeAttribute(resolved.href)}" alt="${escapeAttribute(label)}" loading="lazy">`);
    }
    const resolved = resolveLink(target);
    if (resolved.kind === 'source-only') {
      return storeInline(tokens,
        `<span class="source-reference" title="Repository source path: ${escapeAttribute(resolved.label)}">${label}</span>`);
    }
    if (resolved.kind === 'missing') {
      return storeInline(tokens,
        `<span class="broken-reference" title="Unresolved source target: ${escapeAttribute(resolved.label)}">${label}</span>`);
    }
    const external = resolved.kind === 'external' ? ' rel="noreferrer"' : '';
    return storeInline(tokens,
      `<a href="${escapeAttribute(resolved.href)}"${external}>${label}</a>`);
  });

  rendered = rendered.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/gu, (_match, href) =>
    storeInline(tokens, `<a href="${escapeAttribute(href)}" rel="noreferrer">${escapeHtml(href)}</a>`));
  rendered = rendered.replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>');
  rendered = rendered.replace(/__([^_]+)__/gu, '<strong>$1</strong>');
  rendered = rendered.replace(/~~([^~]+)~~/gu, '<del>$1</del>');
  rendered = rendered.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/gu, '$1<em>$2</em>');
  rendered = rendered.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/gu, '$1<em>$2</em>');
  rendered = rendered.replace(/\\([\\`*{}\[\]()#+.!_>-])/gu, '$1');
  // A link label can itself contain an inline-code placeholder, so restoring
  // the outer link may reveal an inner token. Iterate to a fixed point and
  // reject any impossible cycle rather than emitting NUL placeholders.
  for (let pass = 0; rendered.includes('\u0000INLINE'); pass += 1) {
    if (pass > tokens.length) fail('inline token restoration did not converge');
    rendered = rendered.replace(/\u0000INLINE(\d+)\u0000/gu, (_match, index) => tokens[Number(index)]);
  }
  return rendered;
}

function splitTableRow(line) {
  const cells = [];
  let cell = '';
  let escaped = false;
  let inCode = false;
  const body = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  for (const character of body) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      cell += character;
      escaped = true;
    } else if (character === '`') {
      cell += character;
      inCode = !inCode;
    } else if (character === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function listMarker(line) {
  const match = /^(\s*)([-+*]|\d+\.)\s+(.+)$/u.exec(line);
  if (!match) return null;
  return {
    indent: match[1].replaceAll('\t', '    ').length,
    ordered: /\d+\./u.test(match[2]),
    text: match[3],
  };
}

function renderList(lines, start, baseIndent, resolveLink) {
  const first = listMarker(lines[start]);
  const ordered = first.ordered;
  const tag = ordered ? 'ol' : 'ul';
  const items = [];
  let i = start;
  while (i < lines.length) {
    const marker = listMarker(lines[i]);
    if (!marker || marker.indent !== baseIndent || marker.ordered !== ordered) break;
    let item = renderInline(marker.text, resolveLink);
    i += 1;
    const nested = [];
    const continuations = [];
    while (i < lines.length) {
      const next = listMarker(lines[i]);
      if (next && next.indent === baseIndent) break;
      if (next && next.indent > baseIndent) {
        const result = renderList(lines, i, next.indent, resolveLink);
        nested.push(result.html);
        i = result.next;
        continue;
      }
      if (lines[i].trim() === '') {
        const afterBlank = listMarker(lines[i + 1] ?? '');
        if (afterBlank && afterBlank.indent >= baseIndent) {
          i += 1;
          continue;
        }
        break;
      }
      if (/^\s+/u.test(lines[i])) {
        continuations.push(lines[i].trim());
        i += 1;
        continue;
      }
      break;
    }
    if (continuations.length > 0) item += ` ${renderInline(continuations.join(' '), resolveLink)}`;
    items.push(`<li>${item}${nested.join('')}</li>`);
  }
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: i };
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? '';
  const next = lines[index + 1] ?? '';
  return /^#{1,6}\s+/u.test(line)
    || /^```/u.test(line)
    || /^>/u.test(line)
    || /^\s*(?:[-+*]|\d+\.)\s+/u.test(line)
    || /^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)
    || /^<a\s+id="[^"]+"\s*><\/a>\s*$/u.test(line)
    || /^<img\s+/u.test(line)
    || /^<!--/u.test(line)
    || (line.trim().startsWith('|') && next.trim().startsWith('|') && isTableSeparator(next));
}

function renderMarkdown(body, { sourcePath, routesBySource, closureVersion, basePath }) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const resolveLink = makeLinkResolver({ routesBySource, sourcePath, basePath });
  const html = [];
  const { anchors, directAnchors, duplicateAnchors } = markdownAnchorPlan(body);
  if (duplicateAnchors.size > 0) {
    fail(`${sourcePath}: duplicate rendered anchor #${[...duplicateAnchors][0]}`);
  }
  const fenceLabels = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const fence = /^```([^\s`]*)\s*(.*)$/u.exec(line);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && lines[i] !== '```') {
        code.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) fail(`${sourcePath}: unterminated code fence`);
      i += 1;
      const language = fence[1] ? ` class="language-${escapeAttribute(fence[1])}"` : '';
      html.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      const id = directAnchors.get(i)?.id;
      if (!id) fail(`${sourcePath}: missing shared anchor identity for heading`);
      html.push(`<h${level} id="${escapeAttribute(id)}">${renderInline(heading[2], resolveLink)}<a class="heading-link" href="#${escapeAttribute(id)}" aria-label="Link to this section">#</a></h${level}>`);
      i += 1;
      continue;
    }

    const explicitAnchor = /^<a\s+id="([^"]+)"\s*><\/a>\s*$/u.exec(line);
    if (explicitAnchor) {
      const id = directAnchors.get(i)?.id;
      if (!id) fail(`${sourcePath}: missing shared anchor identity for explicit anchor`);
      html.push(`<a id="${escapeAttribute(id)}" class="identity-anchor" aria-hidden="true"></a>`);
      i += 1;
      continue;
    }

    const rawImage = /^<img\s+src="([^"]+)"\s+alt="([^"]*)"(?:\s+width="(\d+)")?\s*\/>\s*$/u.exec(line);
    if (rawImage) {
      const resolved = resolveLink(rawImage[1], { asset: true });
      if (resolved.kind !== 'internal') fail(`${sourcePath}: image does not resolve to a bundled asset: ${rawImage[1]}`);
      const width = rawImage[3] ? ` width="${rawImage[3]}"` : '';
      html.push(`<p class="brand-mark"><img src="${escapeAttribute(resolved.href)}" alt="${escapeAttribute(rawImage[2])}"${width}></p>`);
      i += 1;
      continue;
    }

    const sinceMarker = /^<!--\s*since:\s*(\d+\.\d+\.\d+)(\s+unreleased)?\s*-->$/u.exec(line.trim());
    if (sinceMarker) {
      const version = sinceMarker[1];
      const unreleased = sinceMarker[2] !== undefined;
      const label = unreleased
        ? `Unreleased · expected in ${version} · not in published closure ${closureVersion}`
        : `Available since published closure ${version}`;
      const css = unreleased ? 'availability--unreleased' : 'availability--released';
      html.push(`<aside class="availability ${css}" data-since="${version}" data-unreleased="${unreleased}">${escapeHtml(label)}</aside>`);
      fenceLabels.push({ version, unreleased, kind: 'section' });
      i += 1;
      continue;
    }

    if (/^<!--[\s\S]*-->\s*$/u.test(line.trim())) {
      i += 1;
      continue;
    }

    if (line.trim().startsWith('|') && lines[i + 1]?.trim().startsWith('|') && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const columnCount = headers.length;
      html.push('<div class="table-wrap"><table>');
      html.push(`<thead><tr>${headers.map((cell) => `<th>${renderInline(cell, resolveLink)}</th>`).join('')}</tr></thead>`);
      html.push('<tbody>');
      for (const row of rows) {
        const normalizedRow = [...row];
        while (normalizedRow.length < columnCount) normalizedRow.push('');
        const gap = normalizedRow.some((cell) => /\bGAP\b/u.test(cell)) ? ' class="gap-row"' : '';
        html.push(`<tr${gap}>${normalizedRow.slice(0, columnCount).map((cell) => `<td>${renderInline(cell, resolveLink)}</td>`).join('')}</tr>`);
      }
      html.push('</tbody></table></div>');
      continue;
    }

    if (line.startsWith('>')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quote.push(lines[i].replace(/^> ?/u, ''));
        i += 1;
      }
      const className = quote[0]?.startsWith('**Unreleased.**') ? ' class="unreleased-banner"' : '';
      const renderedQuote = renderMarkdown(quote.join('\n'), {
        sourcePath,
        routesBySource,
        closureVersion,
        basePath,
      });
      html.push(`<blockquote${className}>${renderedQuote.html}</blockquote>`);
      fenceLabels.push(...renderedQuote.fenceLabels);
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const result = renderList(lines, i, marker.indent, resolveLink);
      html.push(result.html);
      i = result.next;
      continue;
    }

    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)) {
      html.push('<hr>');
      i += 1;
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines, i)) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(' '), resolveLink)}</p>`);
  }

  return { html: html.join('\n'), anchors, fenceLabels };
}

function humanSectionName(section) {
  if (section === '.') return 'Guide';
  return section.split('-').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

function renderNavigation(manifest, routesById, currentId) {
  const groups = [];
  for (const [section, entries] of Object.entries(manifest.nav ?? {})) {
    const links = entries.map((entry) => {
      const route = routesById.get(entry.id);
      if (!route) fail(`manifest navigation refers to unknown page id ${entry.id}`);
      const current = entry.id === currentId ? ' aria-current="page" class="current"' : '';
      return `<li><a href="${route}"${current}>${escapeHtml(entry.title)}</a></li>`;
    }).join('');
    const open = entries.some((entry) => entry.id === currentId) ? ' open' : '';
    groups.push(`<details${open}><summary>${escapeHtml(humanSectionName(section))}</summary><ul>${links}</ul></details>`);
  }
  return groups.join('\n');
}

function authoringProfileLabel(profiles) {
  if (!Array.isArray(profiles)) return 'Authoring scope unavailable';
  if (profiles.length === 0) return 'Profile-neutral';
  if (profiles.length === 1 && profiles[0] === 'explicit') return 'Explicit only';
  if (profiles.length === 1 && profiles[0] === 'familiar') return 'Familiar only';
  if (profiles.join(',') === 'explicit,familiar') return 'Explicit + Familiar';
  fail(`invalid manifest authoringProfiles ${JSON.stringify(profiles)}`);
}

function renderPage({
  sourcePath,
  page,
  body,
  manifest,
  routesBySource,
  routesById,
  binding,
  basePath,
  canonicalBasePath,
}) {
  const rendered = renderMarkdown(body, {
    sourcePath,
    routesBySource,
    closureVersion: binding.closure.version,
    basePath,
  });
  const pageLabels = [];
  if (page.since) {
    const unreleased = page.unreleased === true;
    const label = unreleased
      ? `Unreleased page · expected in ${page.since} · not in published closure ${binding.closure.version}`
      : `Available since published closure ${page.since}`;
    const css = unreleased ? 'availability--unreleased' : 'availability--released';
    pageLabels.push(`<aside class="availability ${css}" data-since="${page.since}" data-unreleased="${unreleased}">${escapeHtml(label)}</aside>`);
    rendered.fenceLabels.unshift({ version: page.since, unreleased, kind: 'page' });
  }
  if (sourcePath.startsWith('guide/reference/')) {
    pageLabels.push(
      `<aside class="reference-boundary"><strong>Build-bound reference.</strong> ` +
      `A symbol’s presence here is not by itself a package-publication claim. ` +
      `Published availability is governed by closure ${escapeHtml(binding.closure.version)} and explicit fences.</aside>`,
    );
  }
  const targetLabel = Array.isArray(page.targets) ? page.targets.join(', ') : 'unspecified';
  const profileLabel = authoringProfileLabel(page.authoringProfiles);
  const navigation = renderNavigation(manifest, routesById, page.id);
  const canonicalRoute = pageRoute(sourcePath, canonicalBasePath);
  const canonicalLink = basePath === canonicalBasePath
    ? `  <link rel="canonical" href="${escapeAttribute(canonicalRoute)}">\n`
    : '';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="scripts/generate-docs-site.mjs">
  <meta name="snapback-published-closure" content="${escapeAttribute(binding.closure.version)}">
  <meta name="snapback-guide-content-sha256" content="${escapeAttribute(binding.guide.contentDigest)}">
  <title>${escapeHtml(page.title)} · Snapback Guide</title>
${canonicalLink}  <link rel="icon" href="${atBase(basePath, '/assets/favicon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="${atBase(basePath, '/assets/site.css')}">
</head>
<body>
  <a class="skip-link" href="#content">Skip to content</a>
  <header class="topbar">
    <a class="wordmark" href="${basePath}"><img src="${atBase(basePath, '/assets/snapback-mark.svg')}" alt="" width="30" height="30">Snapback Guide</a>
    <span class="closure-chip">Closure ${escapeHtml(binding.closure.version)}</span>
  </header>
  <div class="layout">
    <nav class="sidebar" aria-label="Guide navigation">
      <a class="nav-primary" href="${atBase(basePath, '/capabilities/')}">Capability index</a>
      <a class="nav-primary" href="${atBase(basePath, '/reference/')}">API reference</a>
      ${navigation}
    </nav>
    <main id="content" data-guide-id="${escapeAttribute(page.id)}" data-source-path="${escapeAttribute(sourcePath)}">
      <div class="page-meta"><span>${escapeHtml(page.maturity ?? 'unknown')}</span><span>${escapeHtml(targetLabel)}</span><span data-authoring-profiles="${escapeAttribute((page.authoringProfiles ?? []).join(','))}">${escapeHtml(profileLabel)}</span><span>${escapeHtml(sourcePath)}</span></div>
      ${pageLabels.join('\n')}
      ${rendered.html}
    </main>
  </div>
  <footer>
    <span>Published projection — D1 ruled 2026-08-08</span>
    <span>Published closure ${escapeHtml(binding.closure.version)}</span>
    <span>Guide content <code>${escapeHtml(binding.guide.contentDigest)}</code></span>
    <span>Package qualification marker ${escapeHtml(binding.closure.newestQualified ?? 'not recorded')}</span>
    <a href="${atBase(basePath, '/site-manifest.json')}">site-manifest.json</a>
  </footer>
</body>
</html>
`;
  return { html, fenceLabels: rendered.fenceLabels };
}

function sourceCss() {
  return `:root {
  color-scheme: light dark;
  --bg: #f7f6f2;
  --panel: #ffffff;
  --text: #1f2328;
  --muted: #626b76;
  --line: #d7d9dc;
  --accent: #2747d9;
  --code: #f0f1f3;
  --released: #e9f7ee;
  --released-text: #155c35;
  --unreleased: #fff1cf;
  --unreleased-text: #734b00;
  --gap: #fff7e8;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.62 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color: var(--accent); text-underline-offset: 0.18em; }
.skip-link { position: absolute; left: -9999px; top: 0; z-index: 10; padding: .6rem 1rem; background: var(--panel); }
.skip-link:focus { left: 1rem; top: 1rem; }
.topbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 56px; padding: .65rem 1.1rem; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--panel) 94%, transparent); backdrop-filter: blur(12px); }
.wordmark { display: inline-flex; align-items: center; gap: .55rem; color: var(--text); font-weight: 750; text-decoration: none; }
.wordmark img { display: block; }
.closure-chip, .page-meta span { border: 1px solid var(--line); border-radius: 999px; padding: .15rem .55rem; color: var(--muted); font-size: .78rem; }
.layout { display: grid; grid-template-columns: minmax(230px, 300px) minmax(0, 860px); justify-content: center; gap: clamp(1rem, 3vw, 3rem); max-width: 1260px; margin: 0 auto; padding: 1.4rem; }
.sidebar { position: sticky; top: 74px; align-self: start; max-height: calc(100vh - 92px); overflow: auto; padding: .45rem .8rem .8rem; border-right: 1px solid var(--line); font-size: .88rem; }
.sidebar details { margin: .28rem 0; }
.sidebar summary { cursor: pointer; color: var(--muted); font-weight: 700; }
.sidebar ul { list-style: none; margin: .25rem 0 .8rem; padding: 0 0 0 .7rem; }
.sidebar li { margin: .16rem 0; }
.sidebar a { display: block; padding: .18rem .35rem; border-radius: 5px; color: var(--text); text-decoration: none; }
.sidebar a:hover, .sidebar a.current { background: var(--code); color: var(--accent); }
.sidebar .nav-primary { font-weight: 750; margin: .15rem 0; }
main { min-width: 0; padding: .4rem 0 4rem; }
.page-meta { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0 0 1rem; }
h1, h2, h3, h4 { line-height: 1.22; letter-spacing: -.018em; scroll-margin-top: 78px; }
h1 { margin-top: .4rem; font-size: clamp(2rem, 5vw, 3.2rem); }
h2 { margin-top: 2.8rem; padding-top: .2rem; border-top: 1px solid var(--line); }
h3 { margin-top: 2rem; }
.heading-link { opacity: 0; margin-left: .45rem; font-size: .72em; text-decoration: none; }
h1:hover .heading-link, h2:hover .heading-link, h3:hover .heading-link, h4:hover .heading-link, .heading-link:focus { opacity: 1; }
p, li { max-width: 76ch; }
pre { max-width: 100%; overflow: auto; padding: 1rem; border: 1px solid var(--line); border-radius: 8px; background: #161b22; color: #e6edf3; font: .86rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
code { padding: .08em .3em; border-radius: 4px; background: var(--code); font: .9em/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
pre code { padding: 0; background: transparent; overflow-wrap: normal; }
blockquote { margin: 1.2rem 0; padding: .25rem 1rem; border-left: 4px solid var(--line); color: var(--muted); }
.availability, .reference-boundary { margin: 1rem 0; padding: .75rem 1rem; border: 1px solid; border-radius: 8px; font-size: .92rem; }
.availability--released { border-color: #9bd2ae; background: var(--released); color: var(--released-text); }
.availability--unreleased, .unreleased-banner { border-color: #e0b44c; background: var(--unreleased); color: var(--unreleased-text); }
.reference-boundary { border-color: var(--line); background: var(--code); }
.table-wrap { max-width: 100%; overflow-x: auto; margin: 1.2rem 0; border: 1px solid var(--line); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); font-size: .88rem; }
th, td { padding: .55rem .65rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
th { position: sticky; top: 55px; background: var(--code); }
.gap-row { background: var(--gap); }
.source-reference { text-decoration: underline dotted; text-underline-offset: .2em; cursor: help; }
.broken-reference, .missing-asset { color: #a12424; text-decoration: line-through; }
.brand-mark img { display: block; }
footer { display: flex; flex-wrap: wrap; justify-content: center; gap: .45rem 1.1rem; padding: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .78rem; }
footer code { word-break: break-all; }
@media (max-width: 800px) {
  .layout { display: block; padding: 1rem; }
  .sidebar { position: static; max-height: none; margin-bottom: 1.5rem; border: 1px solid var(--line); border-radius: 8px; }
  .closure-chip { display: none; }
  th { position: static; }
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #101318; --panel: #171b22; --text: #e6edf3; --muted: #9aa4af; --line: #343b45; --accent: #8aa4ff; --code: #222832; --released: #122c1e; --released-text: #a5e5bc; --unreleased: #35270c; --unreleased-text: #f2cd75; --gap: #2c250f; }
}
`;
}

function buildLlmsTxt({ pages, binding, basePath }) {
  // @ref LLP 0259#1-first-read-contract — same Read-first order as the
  // served server /llms.txt: the start-packet tier leads (mental model
  // first), and the capability index sits in corpus order as a lookup
  // registry rather than being promoted to the front.
  const startRank = (entry) => {
    if (entry.page.id === 'start.mental-model') return 0;
    if (entry.page.id.startsWith('start.')) return 1;
    return 2;
  };
  const ordered = [...pages].sort((left, right) => {
    const rank = startRank(left) - startRank(right);
    if (rank !== 0) return rank;
    return left.page.order - right.page.order || left.page.id.localeCompare(right.page.id);
  });
  const lines = [
    '# Snapback Guide',
    '',
    `> Published documentation projection of published closure ${binding.closure.version} (D1 ruled 2026-08-08; LLP 0195).`,
    `> Guide content digest: ${binding.guide.contentDigest}`,
    '> Presence in the build-bound API reference is not by itself a package-publication claim.',
    '> Read first: the start.* packet pages below. The capability index is a lookup registry, not a linear first read.',
    '',
    '## Corpus',
    '',
  ];
  for (const entry of ordered) {
    const flags = [];
    if (entry.page.since) flags.push(`since ${entry.page.since}`);
    if (entry.page.unreleased) flags.push('UNRELEASED');
    const suffix = flags.length > 0 ? ` — ${flags.join('; ')}` : '';
    lines.push(`- [${entry.page.title}](${entry.route}) — ${entry.page.id}${suffix}`);
  }
  lines.push(
    '',
    '## Machine-readable identities',
    '',
    `- [Site manifest](${atBase(basePath, '/site-manifest.json')})`,
    `- [Published closure record](${atBase(basePath, '/published-closure.json')})`,
    `- [Generated API symbol registry](${atBase(basePath, '/reference/registry.json')})`,
    `- [Diagnostic code registry](${atBase(basePath, '/reference/diagnostics-registry.json')})`,
    '',
  );
  return lines.join('\n');
}

function contentTypeFor(path) {
  const extension = extname(path).toLowerCase();
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
  }[extension] ?? 'application/octet-stream';
}

function fileSetDigest(files) {
  const digest = createHash('sha256').update(SITE_DIGEST_DOMAIN);
  for (const [path, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    if (path === SITE_MANIFEST_PATH) continue;
    const byteLength = Buffer.byteLength(bytes);
    digest.update(`${Buffer.byteLength(path)}:${path}:${byteLength}:`);
    digest.update(bytes);
    digest.update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
}

function fileInventory(files) {
  return [...files]
    .filter(([path]) => path !== SITE_MANIFEST_PATH)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => ({
      path: `/${path}`,
      mediaType: contentTypeFor(path).split(';')[0],
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
    }));
}

function loadInputs(root) {
  const closurePath = join(root, PUBLISHED_CLOSURE_PATH);
  const guideManifestPath = join(root, MANIFEST_PATH);
  const registryPath = join(root, SYMBOL_REGISTRY_PATH);
  const diagnosticsPath = join(root, DIAGNOSTICS_REGISTRY_PATH);
  const flatPath = join(root, FLAT_PATH);
  const closure = loadJson(closurePath, PUBLISHED_CLOSURE_PATH);
  const manifest = loadJson(guideManifestPath, MANIFEST_PATH);
  const registry = loadJson(registryPath, SYMBOL_REGISTRY_PATH);
  const diagnostics = loadJson(diagnosticsPath, DIAGNOSTICS_REGISTRY_PATH);
  const closureBytes = readFileSync(closurePath);
  const registryBytes = readFileSync(registryPath);
  const diagnosticsBytes = readFileSync(diagnosticsPath);
  const flatBytes = readFileSync(flatPath);

  if (closure.schemaVersion !== 'snapback-published-closure.v1') {
    fail(`${PUBLISHED_CLOSURE_PATH}: unsupported schemaVersion ${closure.schemaVersion}`);
  }
  if (!/^\d+\.\d+\.\d+$/u.test(closure.newestPublished ?? '')) {
    fail(`${PUBLISHED_CLOSURE_PATH}: newestPublished must be X.Y.Z`);
  }
  if (manifest.schemaVersion !== 'snapback-guide.v1') fail(`${MANIFEST_PATH}: unsupported schemaVersion`);
  if (manifest.publishedClosure?.newestPublished !== closure.newestPublished) {
    fail(`${MANIFEST_PATH}: published closure ${manifest.publishedClosure?.newestPublished ?? 'missing'} does not match ${PUBLISHED_CLOSURE_PATH} ${closure.newestPublished}`);
  }
  if (!/^[0-9a-f]{64}$/u.test(manifest.contentHash ?? '')) {
    fail(`${MANIFEST_PATH}: contentHash must be a SHA-256 hex digest`);
  }
  if (!['snapback-symbol-registry.v2', 'snapback-symbol-registry.v1'].includes(registry.schemaVersion)) {
    fail(`${SYMBOL_REGISTRY_PATH}: unsupported schemaVersion`);
  }
  if (!['snapback-diagnostics-registry.v2', 'snapback-diagnostics-registry.v1'].includes(diagnostics.schemaVersion)) {
    fail(`${DIAGNOSTICS_REGISTRY_PATH}: unsupported schemaVersion`);
  }

  const corpus = loadProjectionCorpus(root);
  if (corpus.errors.length > 0) fail(`Guide corpus failed to load:\n${corpus.errors.join('\n')}`);
  const fenceErrors = [];
  checkPublishedClosure(root, corpus.pageInfo, corpus.pageBodies, fenceErrors);
  if (fenceErrors.length > 0) fail(`published-closure fences failed:\n${fenceErrors.join('\n')}`);

  const expectedPaths = new Set(corpus.pagePaths);
  const manifestPaths = new Set(Object.values(manifest.pages ?? {}).map((page) => page.path));
  for (const path of expectedPaths) {
    if (!manifestPaths.has(path)) fail(`${MANIFEST_PATH}: missing corpus page ${path}`);
  }
  for (const path of manifestPaths) {
    if (!expectedPaths.has(path)) fail(`${MANIFEST_PATH}: names non-corpus page ${path}`);
  }
  for (const [id, page] of Object.entries(manifest.pages ?? {})) {
    const info = corpus.pageInfo.get(page.path);
    if (!info) fail(`${MANIFEST_PATH}: page ${id} points at missing ${page.path}`);
    const actual = sha256(info.raw);
    if (page.sha256 !== actual) fail(`${MANIFEST_PATH}: page ${id} sha256 is stale`);
    if (info.frontmatter?.id !== id) fail(`${MANIFEST_PATH}: page id ${id} disagrees with ${page.path}`);
  }

  const expectedFlat = buildFlatGuide(root, manifest, corpus.pageInfo);
  if (!flatBytes.equals(Buffer.from(expectedFlat))) fail(`${FLAT_PATH}: stale relative to manifest navigation`);
  const resource = manifest.resources?.['reference.symbol-registry'];
  if (!resource || resource.path !== SYMBOL_REGISTRY_PATH) {
    fail(`${MANIFEST_PATH}: reference.symbol-registry resource is missing or points elsewhere`);
  }
  if (resource.sha256 !== sha256(registryBytes)) fail(`${MANIFEST_PATH}: symbol registry sha256 is stale`);
  const diagnosticsResource = manifest.resources?.['reference.diagnostics-registry'];
  if (!diagnosticsResource || diagnosticsResource.path !== DIAGNOSTICS_REGISTRY_PATH) {
    fail(`${MANIFEST_PATH}: reference.diagnostics-registry resource is missing or points elsewhere`);
  }
  if (diagnosticsResource.sha256 !== sha256(diagnosticsBytes)) {
    fail(`${MANIFEST_PATH}: diagnostics registry sha256 is stale`);
  }
  const expectedGuideDigest = guideContentHash({
    flat: flatBytes,
    pages: manifest.pages,
    registryBytes,
    diagnosticsBytes,
  });
  if (manifest.contentHash !== expectedGuideDigest) {
    fail(
      `${MANIFEST_PATH}: contentHash does not bind the current flat Guide, `
        + 'authoring-profile scopes, and registries',
    );
  }

  const binding = {
    type: 'qualified-published-closure-content',
    headBinding: 'none',
    closure: {
      recordPath: PUBLISHED_CLOSURE_PATH,
      recordSha256: sha256(closureBytes),
      schemaVersion: closure.schemaVersion,
      scope: closure.scope,
      registry: closure.registry,
      version: closure.newestPublished,
      publishedAt: closure.publishedAt,
      newestQualified: closure.newestQualified,
    },
    guide: {
      manifestPath: MANIFEST_PATH,
      schemaVersion: manifest.schemaVersion,
      contentDigest: `sha256:${manifest.contentHash}`,
    },
    reference: {
      registryPath: SYMBOL_REGISTRY_PATH,
      schemaVersion: registry.schemaVersion,
      sha256: sha256(registryBytes),
      sourceDigest: registry.buildIdentity?.sourceDigest,
      modules: registry.modules?.length ?? 0,
      symbols: registry.symbols?.length ?? 0,
      presenceIsPublicationClaim: false,
      diagnosticsRegistryPath: DIAGNOSTICS_REGISTRY_PATH,
      diagnosticsSha256: sha256(diagnosticsBytes),
      diagnosticCodes: diagnostics.counts?.codes ?? 0,
    },
  };
  return { closure, closureBytes, corpus, manifest, registry, registryBytes, diagnosticsBytes, binding };
}

function buildSite(root, basePath) {
  const inputs = loadInputs(root);
  const { closure, closureBytes, corpus, manifest, registry, registryBytes, diagnosticsBytes, binding } = inputs;
  const publishedRoutes = publicationRoutes(binding.closure.version, basePath);
  binding.closure.snapshotPath = publishedRoutes.snapshot;
  const files = new Map();
  const routesBySource = new Map();
  const routesById = new Map();
  const pages = [];

  for (const [id, page] of Object.entries(manifest.pages)) {
    const route = pageRoute(page.path, basePath);
    const outputPath = routeOutputPath(route, basePath);
    if (routesBySource.has(page.path)) fail(`duplicate source page ${page.path}`);
    if ([...routesBySource.values()].includes(route)) fail(`duplicate site route ${route}`);
    routesBySource.set(page.path, route);
    routesById.set(id, route);
    pages.push({ id, page: { ...page, id }, route, outputPath });
  }

  const renderedFenceLabels = [];
  for (const entry of pages) {
    const body = corpus.pageBodies.get(entry.page.path);
    const rendered = renderPage({
      sourcePath: entry.page.path,
      page: entry.page,
      body,
      manifest,
      routesBySource,
      routesById,
      binding,
      basePath,
      canonicalBasePath: publishedRoutes.canonicalBase,
    });
    files.set(entry.outputPath, rendered.html);
    renderedFenceLabels.push(...rendered.fenceLabels.map((label) => ({ ...label, page: entry.page.id })));
  }

  files.set('assets/site.css', sourceCss());
  files.set('assets/snapback-mark.svg', readFileSync(join(root, 'brand/snapback-mark.svg')));
  files.set('assets/favicon.svg', readFileSync(join(root, 'brand/favicon.svg')));
  files.set('frontmatter.schema.json', readFileSync(join(root, 'guide/frontmatter.schema.json')));
  files.set('published-closure.json', closureBytes);
  files.set('reference/registry.json', registryBytes);
  files.set('reference/diagnostics-registry.json', diagnosticsBytes);
  files.set('llms.txt', buildLlmsTxt({ pages, binding, basePath }));

  const expectedFenceLabels = [];
  for (const entry of pages) {
    if (entry.page.since) {
      expectedFenceLabels.push({
        page: entry.page.id,
        version: entry.page.since,
        unreleased: entry.page.unreleased === true,
        kind: 'page',
      });
    }
    const body = corpus.pageBodies.get(entry.page.path);
    for (const match of body.matchAll(/^<!--\s*since:\s*(\d+\.\d+\.\d+)(\s+unreleased)?\s*-->$/gmu)) {
      expectedFenceLabels.push({
        page: entry.page.id,
        version: match[1],
        unreleased: match[2] !== undefined,
        kind: 'section',
      });
    }
  }
  const sameFence = (left, right) => left?.page === right?.page
    && left?.version === right?.version
    && left?.unreleased === right?.unreleased
    && left?.kind === right?.kind;
  if (renderedFenceLabels.length !== expectedFenceLabels.length
      || renderedFenceLabels.some((label, index) => !sameFence(label, expectedFenceLabels[index]))) {
    const mismatchAt = renderedFenceLabels.findIndex(
      (label, index) => !sameFence(label, expectedFenceLabels[index]),
    );
    fail(
      `availability-fence rendering mismatch at ${mismatchAt}: ` +
      `rendered ${JSON.stringify(renderedFenceLabels[mismatchAt])}, ` +
      `expected ${JSON.stringify(expectedFenceLabels[mismatchAt])}`,
    );
  }

  const siteDigest = fileSetDigest(files);
  const siteManifest = {
    schemaVersion: SITE_SCHEMA,
    generatedBy: 'scripts/generate-docs-site.mjs',
    publicationStatus: 'published-d1-ruled-2026-08-08',
    sourceBinding: binding,
    publicationRoutes: publishedRoutes,
    availabilityFences: {
      total: renderedFenceLabels.length,
      released: renderedFenceLabels.filter((fence) => !fence.unreleased).length,
      unreleased: renderedFenceLabels.filter((fence) => fence.unreleased).length,
      labels: renderedFenceLabels,
    },
    corpus: {
      pages: pages.length,
      capabilityIndex: routesById.get('meta.capabilities'),
      referenceIndex: routesById.get('reference.index'),
      referenceSymbols: registry.symbols?.length ?? 0,
      llms: atBase(basePath, '/llms.txt'),
    },
    site: {
      basePath,
      contentDigest: siteDigest,
      digestExcludes: [`/${SITE_MANIFEST_PATH}`],
      files: fileInventory(files),
    },
  };
  files.set(SITE_MANIFEST_PATH, canonicalJson(siteManifest));
  return {
    files,
    pages,
    routesBySource,
    siteManifest,
    closure,
    manifest,
    registry,
    basePath,
    publicationRoutes: publishedRoutes,
  };
}

function pathFromInternalUrl(rawUrl, fromPath, basePath) {
  const withoutQuery = rawUrl.split('?')[0];
  const { path: targetPath, fragment } = splitTarget(withoutQuery);
  if (targetPath === '') return { path: fromPath, fragment };
  let absolute;
  if (targetPath.startsWith('/')) {
    if (!targetPath.startsWith(basePath)) {
      return { path: null, fragment, outsideBase: true };
    }
    absolute = targetPath.slice(basePath.length);
  } else {
    absolute = normalize(join(dirname(fromPath), targetPath)).split(sep).join('/');
  }
  if (absolute === '' || absolute.endsWith('/')) return { path: `${absolute}index.html`, fragment };
  if (!extname(absolute)) return { path: `${absolute}/index.html`, fragment };
  return { path: absolute, fragment };
}

function validateSite(build) {
  const errors = [];
  const htmlAnchors = new Map();
  let linksChecked = 0;
  for (const [path, bytes] of build.files) {
    if (!path.endsWith('.html')) continue;
    const html = bytes.toString();
    const anchors = new Set();
    for (const match of html.matchAll(/\sid="([^"]+)"/gu)) {
      if (anchors.has(match[1])) errors.push(`/${path}: duplicate id #${match[1]}`);
      anchors.add(match[1]);
    }
    htmlAnchors.set(path, anchors);
    for (const match of html.matchAll(/<(a|link|img|script)\b[^>]*\s(?:href|src)="([^"]+)"/gu)) {
      const [, tag, target] = match;
      if (/^(?:https?:|mailto:|tel:)/u.test(target)) {
        if (tag !== 'a') errors.push(`/${path}: external network asset ${target}`);
        continue;
      }
      if (target.startsWith('data:')) continue;
      const resolved = pathFromInternalUrl(target, path, build.basePath);
      linksChecked += 1;
      if (resolved.outsideBase) {
        errors.push(`/${path}: ${target} is outside configured base path ${build.basePath}`);
        continue;
      }
      if (!build.files.has(resolved.path)) {
        errors.push(`/${path}: ${target} resolves to missing /${resolved.path}`);
        continue;
      }
      if (resolved.fragment) {
        if (!resolved.path.endsWith('.html')) {
          errors.push(`/${path}: ${target} places an anchor on non-HTML /${resolved.path}`);
          continue;
        }
        let decoded = resolved.fragment;
        try {
          decoded = decodeURIComponent(resolved.fragment);
        } catch {
          errors.push(`/${path}: malformed encoded fragment in ${target}`);
        }
        if (!htmlAnchors.has(resolved.path)) {
          const targetHtml = build.files.get(resolved.path).toString();
          htmlAnchors.set(resolved.path, new Set([...targetHtml.matchAll(/\sid="([^"]+)"/gu)].map((entry) => entry[1])));
        }
        if (!htmlAnchors.get(resolved.path).has(decoded)) {
          errors.push(`/${path}: ${target} resolves to missing anchor #${decoded}`);
        }
      }
    }
  }

  const modulePage = new Map((build.registry.modules ?? []).map((module) => [module.module, module.page]));
  let referenceAnchorsChecked = 0;
  for (const symbol of build.registry.symbols ?? []) {
    const sourcePage = modulePage.get(symbol.module);
    if (!sourcePage) {
      errors.push(`symbol ${symbol.identity} has no module page`);
      continue;
    }
    const route = build.routesBySource.get(sourcePage);
    if (!route) {
      errors.push(`symbol ${symbol.identity} points to unrendered ${sourcePage}`);
      continue;
    }
    const outputPath = routeOutputPath(route, build.basePath);
    if (!htmlAnchors.has(outputPath)) {
      const targetHtml = build.files.get(outputPath)?.toString() ?? '';
      htmlAnchors.set(outputPath, new Set([...targetHtml.matchAll(/\sid="([^"]+)"/gu)].map((entry) => entry[1])));
    }
    if (!htmlAnchors.get(outputPath).has(symbol.anchor)) {
      errors.push(`symbol ${symbol.identity} is missing stable anchor ${route}#${symbol.anchor}`);
    }
    referenceAnchorsChecked += 1;
  }
  if (errors.length > 0) fail(`site validation failed:\n${errors.join('\n')}`);
  return { linksChecked, referenceAnchorsChecked };
}

function compareBuilds(left, right) {
  if (left.siteManifest.site.contentDigest !== right.siteManifest.site.contentDigest) {
    fail(`non-deterministic site digest: ${left.siteManifest.site.contentDigest} != ${right.siteManifest.site.contentDigest}`);
  }
  const leftPaths = [...left.files.keys()].sort();
  const rightPaths = [...right.files.keys()].sort();
  if (JSON.stringify(leftPaths) !== JSON.stringify(rightPaths)) fail('non-deterministic site file membership');
  for (const path of leftPaths) {
    if (!Buffer.from(left.files.get(path)).equals(Buffer.from(right.files.get(path)))) {
      fail(`non-deterministic output bytes at /${path}`);
    }
  }
}

function writeBuild(root, build) {
  const outputRoot = join(root, OUTPUT_DIRECTORY);
  const stageRoot = join(root, `.${OUTPUT_DIRECTORY}.staging`);
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
  try {
    for (const [path, bytes] of build.files) {
      const target = join(stageRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    rmSync(outputRoot, { recursive: true, force: true });
    renameSync(stageRoot, outputRoot);
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
  return outputRoot;
}

function serve(root, outputRoot, port, basePath) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0')) throw new Error('invalid path');
      if (!pathname.startsWith(basePath)) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found\n');
        return;
      }
      pathname = `/${pathname.slice(basePath.length)}`;
      if (pathname.endsWith('/')) pathname += 'index.html';
      const candidate = resolve(outputRoot, `.${pathname}`);
      const outputPrefix = `${resolve(outputRoot)}${sep}`;
      if (candidate !== resolve(outputRoot) && !candidate.startsWith(outputPrefix)) throw new Error('path escapes site root');
      if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found\n');
        return;
      }
      const bytes = readFileSync(candidate);
      response.writeHead(200, {
        'content-type': contentTypeFor(candidate),
        'content-length': bytes.byteLength,
        'cache-control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Bad request\n');
    }
  });
  server.on('error', (error) => {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      console.log('[docs-site] loopback binding is unavailable in this sandbox; preview was skipped.');
      console.log(`[docs-site] run from the orchestrator: node scripts/generate-docs-site.mjs --serve --port ${port || DEFAULT_PORT} --base ${basePath}`);
      process.exit(0);
    }
    throw error;
  });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`[docs-site] serving ${relative(root, outputRoot)}/ at http://127.0.0.1:${actualPort}${basePath}`);
    console.log('[docs-site] publication authorized (D1 ruled 2026-08-08); deploy per issues/shelved/20260808-llp0195-docs-site-staging-execution.md.');
  });
}

function printBuildSummary(build, validation, action) {
  console.log(
    `[docs-site] ${action} — ${build.pages.length} pages, ${build.registry.symbols.length} reference symbols, ` +
    `${validation.linksChecked} internal links/assets, ${validation.referenceAnchorsChecked} stable reference anchors`,
  );
  console.log(
    `[docs-site] binding — published closure ${build.closure.newestPublished}, ` +
    `Guide content sha256:${build.manifest.contentHash}, HEAD excluded`,
  );
  console.log(`[docs-site] site content ${build.siteManifest.site.contentDigest}`);
  console.log(`[docs-site] base path ${build.basePath}`);
  console.log(
    `[docs-site] D3 routes — immutable ${build.publicationRoutes.snapshot}, ` +
    `latest alias ${build.publicationRoutes.latestAlias}`,
  );
}

const options = parseArgs(process.argv.slice(2));
const root = repoRoot();
try {
  const first = buildSite(root, options.basePath);
  const validation = validateSite(first);
  if (options.check) {
    const second = buildSite(root, options.basePath);
    compareBuilds(first, second);
    validateSite(second);
    printBuildSummary(first, validation, 'check ok (two deterministic builds)');
  } else {
    const outputRoot = writeBuild(root, first);
    printBuildSummary(first, validation, `wrote ${OUTPUT_DIRECTORY}/`);
    if (options.serve) serve(root, outputRoot, options.port, options.basePath);
  }
} catch (error) {
  console.error(`[docs-site] FAILED: ${error.stack ?? error.message}`);
  process.exit(1);
}
