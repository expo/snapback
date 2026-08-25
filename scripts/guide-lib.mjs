// Shared logic for the Snapback Guide corpus checks and manifest generator.
// @ref LLP 0061#3-verification-snippets-that-ran — transclusion-match snippets,
// consistency joins, content-bound review freshness, manifest as the projection interface.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const GUIDE_DIR = 'guide';
export const MANIFEST_PATH = join(GUIDE_DIR, 'guide-manifest.generated.json');
export const FLAT_PATH = join(GUIDE_DIR, 'guide-flat.generated.md');
export const FLAT_SECTION_PREFIX = join(GUIDE_DIR, 'guide-flat.');
export const FLAT_SECTION_SUFFIX = '.generated.md';
export const CAPABILITIES_PATH = join(GUIDE_DIR, 'capabilities.md');
export const SURFACE_MAP_PATH = join(GUIDE_DIR, 'surface-map.md');
export const INDEX_PATH = join(GUIDE_DIR, 'index.md');
export const PUBLISHED_CLOSURE_PATH = join(GUIDE_DIR, 'published-closure.json');
export const SYMBOL_REGISTRY_PATH = join(GUIDE_DIR, 'reference', 'registry.json');
export const DIAGNOSTICS_REGISTRY_PATH = join(GUIDE_DIR, 'reference', 'diagnostics-registry.json');
export const GUIDE_MCP_MANIFEST_URI = 'snapback-guide://manifest';
export const GUIDE_MCP_FLAT_URI = 'snapback-guide://flat';
export const GUIDE_MCP_FLAT_SECTION_URI_PREFIX = 'snapback-guide://flat/';
export const GUIDE_MCP_PAGE_URI_PREFIX = 'snapback-guide://page/';
const CLASSED_LANGS = new Set(['js', 'mjs', 'ts', 'tsx', 'json', 'contract']);
const MATURITY_RANK = { 'design-only': 0, partial: 1, shipped: 2 };
// 32 KiB at Phase 1; raised as rows accrued (40 KiB in 7486d25e4, 42 KiB in
// 1a890492a, 44 KiB on 2026-08-07 with the testing.large-fixtures and
// clients.optimistic-create rows, 45 KiB on 2026-08-07 with the
// sync.offline-js-arm-sessions row, 47 KiB on 2026-08-08 with the
// operating.store-durable-state row and the concurrent Zerobugs-control
// absorption rows). Raise only alongside genuinely new
// rows — the budget exists to force alias/wording discipline, not to be
// outgrown silently.
// Bumped 48128 -> 51200 on 2026-08-08 for the docs-review integration: four
// new rows (backend.migrations, backend.record-history, clients.micro,
// auth.agent-registration GAP) plus alias additions. Keep the budget tight —
// grow it only with a deliberate row addition, never to absorb prose creep.
// Bumped 51200 -> 52224 on 2026-08-09 for the api.external-exposure row
// (LLP 0204 S1): the page had 73 bytes of headroom before the row.
// Bumped 52224 -> 52736 on 2026-08-10 for the LLP 0220 D2 backend.assets
// citations (view-once demo witness, recipe doc path, llp/0220): the page
// had 28 bytes of headroom before the mandated additions.
// Bumped 52736 -> 53760 on 2026-08-10 for LLP 0219's one new
// clients.dev-diagnostics row; the restructured main left insufficient room
// for the required witness, aliases, authorities, and Guide destination.
// Bumped 53760 -> 55808 on 2026-08-12 for LLP 0227's one new auth.passwords
// row: the page had 40 bytes of headroom before it, and the row must carry
// its nonclaims inline (production blind-accept signup and mail-delivered
// reset are unready, local reset is capture-mailbox only) so the boundary is
// visible in the index rather than only on the page.
// Round 3 preserves both the LLP 0244 and LLP 0245-0249 rows while tightening
// the prose to the charter's pre-wave hard ceiling.
// Bumped 57856 -> 58368 on 2026-08-15 for the backend.familiar-profile-v1
// GAP row (issues/20260815-guide-gap-familiar-authoring-profile-page.md).
// Bumped 58368 -> 58880 on 2026-08-15 for the assets.media-collection.v1
// experimental introduction row (LLP 0239 R3,
// issues/20260815-finish-media-happy-path.md).
// Bumped 58880 -> 60416 on 2026-08-16 for LLP 0240's shipped custom-authority
// and effective-authority-inspection rows.
// Bumped 60416 -> 61440 on 2026-08-21 for the required auth.field-masking GAP
// row owned by LLP 0235 while it was Draft; the index had no room for the classification,
// exact diary vocabulary, owner, review date, filing pointer, and workaround.
// Bumped 61440 -> 63488 on 2026-08-22 because LLP 0061 requires the shipped
// guest-session row and restoring unrelated prose dishonestly truncated to
// make room; see issues/20260822-capability-index-guest-session-row-budget.md.
const CAPABILITIES_SIZE_BUDGET_BYTES = 63488;
const SURFACE_MAP_SIZE_BUDGET_BYTES = 16384;
// Vacuous-pass guards for the source scans: extraction returning fewer
// entries than these floors means the scan broke, not that surface shrank.
const MIN_ROUTE_PATHS = 50;
const MIN_HOST_OPS = 10;
const REVIEWED_AUTHORITIES_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const GIT_AUTHORITY_MAX_BUFFER = 64 * 1024 * 1024;
const GAP_REVIEW_WARNING_DAYS = 7;

function plainInlineText(value) {
  return value
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_~]/gu, '')
    .trim();
}

// Shared with the docs-site renderer so source validation and rendered-site
// validation assign byte-identical identities to authored headings.
export function headingSlug(value, seen = new Map()) {
  const base = plainInlineText(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/gu, '-');
  const stem = base || 'section';
  const count = seen.get(stem) ?? 0;
  seen.set(stem, count + 1);
  return count === 0 ? stem : `${stem}-${count}`;
}

export function markdownAnchors(body) {
  const anchors = new Set();
  const seenHeadings = new Map();
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  let fenced = false;
  for (const line of lines) {
    if (/^```/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      anchors.add(headingSlug(heading[2], seenHeadings));
      continue;
    }
    const explicit = /^<a\s+id="([^"]+)"\s*><\/a>\s*$/u.exec(line);
    if (explicit) anchors.add(explicit[1]);
  }
  return anchors;
}

export function repoRoot() {
  return resolve(dirname(new URL(import.meta.url).pathname), '..');
}

// LLP 0061 Phase 2b: the runtime derives this exact read-only catalog from
// the embedded manifest. Keeping the consistency-side projection explicit
// verifies stable URI uniqueness, manifest membership, and exact page hashes
// without introducing a second generated resource registry.
export function checkGuideMcpProjection(root, manifest, errors) {
  const wholeFlat = manifest?.flatProjections?.whole;
  const resources = [
    { uri: GUIDE_MCP_MANIFEST_URI, path: MANIFEST_PATH },
    {
      uri: wholeFlat?.uri ?? GUIDE_MCP_FLAT_URI,
      path: wholeFlat?.path ?? FLAT_PATH,
      sha256: wholeFlat?.sha256,
      bytes: wholeFlat?.bytes,
    },
  ];
  if (wholeFlat?.path !== FLAT_PATH || wholeFlat?.uri !== GUIDE_MCP_FLAT_URI) {
    errors.push('guide manifest whole flat projection has an invalid path or MCP URI');
  }
  const sectionFlats = Object.entries(manifest?.flatProjections?.sections ?? {})
    .sort(([left], [right]) => left.localeCompare(right));
  if (sectionFlats.length !== Object.keys(manifest?.nav ?? {}).length) {
    errors.push('guide manifest section flat projection count does not match top-level nav sections');
  }
  const expectedSections = new Set(Object.keys(manifest?.nav ?? {}).map(flatSectionName));
  for (const [section, projection] of sectionFlats) {
    const expectedPath = flatSectionPath(section);
    const expectedUri = `${GUIDE_MCP_FLAT_SECTION_URI_PREFIX}${section}`;
    if (projection.path !== expectedPath || projection.uri !== expectedUri) {
      errors.push(`guide manifest section flat projection '${section}' has an invalid path or MCP URI`);
    }
    if (!expectedSections.delete(section)) {
      errors.push(`guide manifest has an unexpected section flat projection '${section}'`);
    }
    resources.push({
      uri: projection.uri,
      path: projection.path,
      sha256: projection.sha256,
      bytes: projection.bytes,
    });
  }
  for (const section of expectedSections) {
    errors.push(`guide manifest is missing section flat projection '${section}'`);
  }
  const pages = Object.entries(manifest?.pages ?? {}).sort(([leftId, left], [rightId, right]) =>
    Number(left.order ?? Number.MAX_SAFE_INTEGER) - Number(right.order ?? Number.MAX_SAFE_INTEGER) ||
    leftId.localeCompare(rightId),
  );
  for (const [id, page] of pages) {
    resources.push({ uri: `${GUIDE_MCP_PAGE_URI_PREFIX}${id}`, path: page.path, sha256: page.sha256 });
  }
  for (const [id, resource] of Object.entries(manifest?.resources ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (resource.projections?.mcp === true) {
      resources.push({ uri: resource.uri, path: resource.path, sha256: resource.sha256, id });
    }
  }
  const uris = new Set();
  for (const resource of resources) {
    if (uris.has(resource.uri)) errors.push(`guide MCP projection repeats resource URI ${resource.uri}`);
    uris.add(resource.uri);
    const absolute = join(root, resource.path ?? '');
    if (!existsSync(absolute)) {
      errors.push(`guide MCP resource ${resource.uri} references missing ${resource.path}`);
      continue;
    }
    if (resource.sha256) {
      const bytes = readFileSync(absolute);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== resource.sha256) {
        errors.push(`guide MCP resource ${resource.uri} does not match manifest sha256`);
      }
      if (resource.bytes !== undefined && bytes.byteLength !== resource.bytes) {
        errors.push(`guide MCP resource ${resource.uri} does not match manifest byte count`);
      }
    }
  }
  for (const [id, resource] of Object.entries(manifest?.resources ?? {})) {
    const absolute = join(root, resource.path ?? '');
    if (!existsSync(absolute)) {
      errors.push(`guide manifest resource ${id} references missing ${resource.path}`);
      continue;
    }
    const bytes = readFileSync(absolute);
    if (createHash('sha256').update(bytes).digest('hex') !== resource.sha256) {
      errors.push(`guide manifest resource ${id} does not match its sha256`);
    }
    if (bytes.byteLength !== resource.bytes) {
      errors.push(`guide manifest resource ${id} does not match its byte count`);
    }
  }
  return resources;
}

export function listGuidePages(root) {
  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'eval-runs') walk(path);
      } else if (entry.endsWith('.md')) {
        const repoPath = relative(root, path);
        if (!isFlatProjectionPath(repoPath)) pages.push(repoPath);
      }
    }
  };
  walk(join(root, GUIDE_DIR));
  return pages;
}

export function flatSectionName(navSection) {
  return navSection === '.' ? 'meta' : navSection;
}

export function flatSectionPath(section) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(section)) {
    throw new Error(`invalid guide flat section '${section}'`);
  }
  return `${FLAT_SECTION_PREFIX}${section}${FLAT_SECTION_SUFFIX}`;
}

export function isFlatProjectionPath(path) {
  return path === FLAT_PATH
    || (path.startsWith(FLAT_SECTION_PREFIX) && path.endsWith(FLAT_SECTION_SUFFIX));
}

export function listFlatSectionPaths(root) {
  return readdirSync(join(root, GUIDE_DIR))
    .map((name) => join(GUIDE_DIR, name))
    .filter((path) => path !== FLAT_PATH && isFlatProjectionPath(path))
    .sort();
}

// Frontmatter uses the flat subset only: `key: value` scalars and inline
// arrays (`key: [a, b]`) — see guide/conventions.md.
export function parseFrontmatter(text, path, errors) {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    errors.push(`${path}: missing frontmatter opening '---'`);
    return { frontmatter: null, body: text };
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) {
    errors.push(`${path}: unterminated frontmatter`);
    return { frontmatter: null, body: text };
  }
  const frontmatter = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    if (!m) {
      errors.push(`${path}: frontmatter line outside the flat subset: ${JSON.stringify(line)}`);
      continue;
    }
    const [, key, raw] = m;
    frontmatter[key] = raw.startsWith('[')
      ? raw
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .split(',')
          .map((item) => unquote(item.trim()))
          .filter((item) => item.length > 0)
      : unquote(raw.trim());
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n') };
}

function unquote(value) {
  const m = value.match(/^"(.*)"$/) ?? value.match(/^'(.*)'$/);
  return m ? m[1] : value;
}

const REQUIRED_FIELDS = [
  'title', 'id', 'order', 'audience', 'capabilities', 'authorities',
  'examples', 'status', 'targets', 'maturity', 'reviewed',
  'reviewed-authorities-digest',
];

export function validateFrontmatter(fm, path, errors) {
  for (const field of REQUIRED_FIELDS) {
    if (fm[field] === undefined) errors.push(`${path}: frontmatter missing required field '${field}'`);
  }
  const check = (field, ok, expect) => {
    if (fm[field] !== undefined && !ok) errors.push(`${path}: frontmatter '${field}' ${expect}`);
  };
  check('id', /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/.test(fm.id ?? ''), 'must be a dotted lowercase id');
  check('order', /^\d+$/.test(fm.order ?? ''), 'must be a non-negative integer');
  check('audience', fm.audience === 'agent-first', "must be 'agent-first'");
  check('status', ['draft', 'current', 'deprecated'].includes(fm.status), 'must be draft|current|deprecated');
  check('maturity', Object.hasOwn(MATURITY_RANK, fm.maturity ?? ''), 'must be shipped|partial|design-only');
  check('since', /^\d+\.\d+\.\d+$/.test(fm.since ?? ''), 'must be a three-component version (X.Y.Z)');
  check('unreleased', fm.unreleased === 'true', "must be the boolean true");
  check('reviewed', /^\d{4}-\d{2}-\d{2}$/.test(fm.reviewed ?? ''), 'must be YYYY-MM-DD');
  check(
    'reviewed-authorities-digest',
    REVIEWED_AUTHORITIES_DIGEST_PATTERN.test(fm['reviewed-authorities-digest'] ?? ''),
    'must be a sha256: content digest',
  );
  if (Array.isArray(fm.targets)) {
    for (const t of fm.targets) {
      if (!['local', 'cloudflare', 'all'].includes(t)) errors.push(`${path}: unknown target '${t}'`);
    }
    if (fm.targets.length === 0) errors.push(`${path}: 'targets' must not be empty`);
  } else if (fm.targets !== undefined) {
    errors.push(`${path}: 'targets' must be an array`);
  }
  for (const field of ['capabilities', 'authorities', 'examples']) {
    if (fm[field] !== undefined && !Array.isArray(fm[field])) errors.push(`${path}: '${field}' must be an array`);
  }
}

function validateTargetBanner(fm, body, path, errors) {
  if (!Array.isArray(fm?.targets) || fm.targets.length !== 1 || fm.targets[0] !== 'local') return;
  const lines = body.split('\n');
  const firstH2 = lines.findIndex((line) => line.startsWith('## '));
  const preamble = lines.slice(0, firstH2 === -1 ? lines.length : firstH2).join('\n');
  // @ref LLP 0061#1-the-corpus-guide — local-only guarantees must render an
  // explicit target-honesty fence, not rely on frontmatter that readers may
  // never see.
  if (!preamble.includes('> **Local target only.**')) {
    errors.push(
      `${path}: targets: [local] requires a rendered '> **Local target only.**' banner before the first ## heading`,
    );
  }
}

const THREE_COMPONENT_VERSION = /^\d+\.\d+\.\d+$/;
const SECTION_SINCE_MARKER = /^<!--\s*since:\s*(\d+\.\d+\.\d+)(\s+unreleased)?\s*-->$/;

export function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (leftParts[i] !== rightParts[i]) return leftParts[i] - rightParts[i];
  }
  return 0;
}

function loadPublishedClosure(root, errors) {
  const path = join(root, PUBLISHED_CLOSURE_PATH);
  if (!existsSync(path)) {
    errors.push(`${PUBLISHED_CLOSURE_PATH}: missing published-closure record`);
    return null;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`${PUBLISHED_CLOSURE_PATH}: malformed JSON (${error.message})`);
    return null;
  }
  let valid = true;
  if (record?.schemaVersion !== 'snapback-published-closure.v1') {
    errors.push(`${PUBLISHED_CLOSURE_PATH}: schemaVersion must be 'snapback-published-closure.v1'`);
    valid = false;
  }
  if (!THREE_COMPONENT_VERSION.test(record?.newestPublished ?? '')) {
    errors.push(`${PUBLISHED_CLOSURE_PATH}: newestPublished must be a three-component version (X.Y.Z)`);
    valid = false;
  }
  return valid ? record : null;
}

function blockquoteAt(lines, start, newestPublished) {
  if (start >= lines.length || !lines[start].startsWith('> **Unreleased.**')) return false;
  const blockquote = [];
  for (let i = start; i < lines.length && lines[i].startsWith('>'); i += 1) {
    blockquote.push(lines[i]);
  }
  return blockquote.join('\n').includes(newestPublished);
}

function hasPageUnreleasedBanner(lines, newestPublished) {
  const firstH2 = lines.findIndex((line) => line.startsWith('## '));
  const end = firstH2 === -1 ? lines.length : firstH2;
  for (let i = 0; i < end; i += 1) {
    if (blockquoteAt(lines, i, newestPublished)) return true;
  }
  return false;
}

// @ref LLP 0061#3-verification-snippets-that-ran — guide-consistency joins
// authored availability claims to the checked-in published package closure.
export function checkPublishedClosure(root, pageInfo, pageBodies, errors) {
  const publishedClosure = loadPublishedClosure(root, errors);
  if (!publishedClosure) return;
  const { newestPublished } = publishedClosure;

  for (const [path, info] of pageInfo) {
    const fm = info.frontmatter ?? {};
    const since = fm.since;
    const unreleased = fm.unreleased === 'true';
    const validSince = since === undefined || THREE_COMPONENT_VERSION.test(since);
    if (!validSince) continue; // validateFrontmatter owns the malformed-field diagnostic.

    if (
      since !== undefined &&
      fm.maturity === 'shipped' &&
      compareVersions(since, newestPublished) > 0 &&
      !unreleased
    ) {
      errors.push(
        `${path}: page claims a surface the newest published closure (${newestPublished}) does not contain; ` +
        `declare 'unreleased: true' with the rendered banner, or correct 'since'`,
      );
    }

    if (unreleased) {
      if (since === undefined) {
        errors.push(`${path}: 'unreleased: true' requires 'since: X.Y.Z'`);
      } else if (compareVersions(since, newestPublished) <= 0) {
        errors.push(
          `${path}: stale unreleased fence: the published closure now contains this surface — ` +
          `remove the fence (or bump since:)`,
        );
      }
      const lines = (pageBodies.get(path) ?? '').split('\n');
      if (!hasPageUnreleasedBanner(lines, newestPublished)) {
        errors.push(
          `${path}: unreleased page requires a rendered banner blockquote starting '> **Unreleased.**' ` +
          `before the first ## heading and containing ${newestPublished}`,
        );
      }
    }
  }

  for (const [path, body] of pageBodies) {
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!/^<!--\s*since:/.test(trimmed)) continue;
      const marker = SECTION_SINCE_MARKER.exec(trimmed);
      if (!marker) {
        errors.push(
          `${path}:${i + 1}: invalid since marker; expected '<!-- since: X.Y.Z -->' or ` +
          `'<!-- since: X.Y.Z unreleased -->' on a line by itself`,
        );
        continue;
      }
      const version = marker[1];
      const isUnreleased = marker[2] !== undefined;
      const comparison = compareVersions(version, newestPublished);
      if (!isUnreleased && comparison > 0) {
        errors.push(
          `${path}:${i + 1}: section since ${version} is newer than published closure ${newestPublished}; ` +
          `declare the marker unreleased and add the rendered banner`,
        );
      }
      if (isUnreleased && comparison <= 0) {
        errors.push(
          `${path}:${i + 1}: stale unreleased fence: the published closure now contains this surface — ` +
          `remove the marker + banner or bump the version`,
        );
      }
      if (isUnreleased) {
        let next = i + 1;
        while (next < lines.length && lines[next].trim() === '') next += 1;
        if (!blockquoteAt(lines, next, newestPublished)) {
          errors.push(
            `${path}:${i + 1}: unreleased section marker must be immediately followed by a rendered ` +
            `banner blockquote starting '> **Unreleased.**' and containing ${newestPublished}`,
          );
        }
      }
    }
  }
}

export function extractFences(body, path) {
  const fences = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].match(/^```(\S+)?\s*(.*)$/);
    if (!open || lines[i] === '```') continue;
    const lang = open[1] ?? '';
    const info = open[2] ?? '';
    const bodyLines = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== '```') {
      bodyLines.push(lines[j]);
      j += 1;
    }
    fences.push({ path, line: i + 1, lang, info, body: bodyLines.join('\n') });
    i = j;
  }
  return fences;
}

const normalize = (text) => text.split('\n').map((line) => line.replace(/\s+$/, '')).join('\n');

// Guide pages transclude from demo-generated output, which a fresh
// worktree/clone does not have yet — this docs-only fast path never runs
// codegen itself. Point at the exact canonical remediation instead of a
// bare "missing file" (LLP 0061; ticketed after this was hit repeatedly
// with no pointer to the fix).
function missingDemoArtifactHint(ref) {
  if (/^demos\/[^/]+\/(?:snapback\/generated\/contract|surfaces\/contract)\//.test(ref)) {
    return ' — this is Exact/Contract-generated output; run `bun install --frozen-lockfile --cwd demos/<name>/surfaces/contract && bun demos/<name>/tests/acceptance/contract.mjs` first (see scripts/verify-local-proof\'s exact-<name>-install/-contract jobs)';
  }
  if (/^demos\/[^/]+\/snapback\/generated\//.test(ref)) {
    return ' — run `./scripts/check-generated-artifacts` first (it regenerates every committed demo backend, including any SNAPBACK_OUTBOUND_ACTIONS-gated ones per scripts/generated-artifact-policy.mjs)';
  }
  return '';
}

export function checkSnippets(root, pageBodies, errors) {
  const records = new Map();
  for (const [path, body] of pageBodies) {
    const pageSnippets = [];
    for (const fence of extractFences(body, path)) {
      if (!CLASSED_LANGS.has(fence.lang)) continue;
      const source = fence.info.match(/(?:^|\s)source=(\S+)/)?.[1];
      const fragment = /(?:^|\s)fragment(?:\s|$)/.test(fence.info);
      const standalone = /(?:^|\s)standalone(?:\s|$)/.test(fence.info);
      if (standalone) {
        errors.push(`${path}:${fence.line}: the standalone-runnable snippet class is reserved — transclude from a CI-exercised file instead (guide/conventions.md)`);
        continue;
      }
      if (fragment) {
        if (!/reason="[^"]+"/.test(fence.info)) {
          errors.push(`${path}:${fence.line}: fragment fence must declare reason="..."`);
        }
        pageSnippets.push({ lang: fence.lang, class: 'fragment' });
        continue;
      }
      if (!source) {
        errors.push(`${path}:${fence.line}: ${fence.lang} fence needs source=<repo-path> or fragment reason="..."`);
        continue;
      }
      const sourcePath = join(root, source);
      if (!existsSync(sourcePath)) {
        errors.push(`${path}:${fence.line}: snippet source does not exist: ${source}${missingDemoArtifactHint(source)}`);
        continue;
      }
      const fileText = normalize(readFileSync(sourcePath, 'utf8'));
      if (!fileText.includes(normalize(fence.body))) {
        errors.push(`${path}:${fence.line}: snippet is not a verbatim excerpt of ${source} (source drifted or excerpt edited — update the page with the source)`);
        continue;
      }
      pageSnippets.push({ lang: fence.lang, class: 'transcluded', source });
    }
    records.set(path, pageSnippets);
  }
  return records;
}

export function checkLinks(root, pageBodies, errors, warnings) {
  const graph = new Map();
  const anchorsByPath = new Map(
    [...pageBodies].map(([path, body]) => [path, markdownAnchors(body)]),
  );
  const checkAnchor = (sourcePath, targetPath, rawFragment, label) => {
    if (!rawFragment || !anchorsByPath.has(targetPath)) return;
    let fragment;
    try {
      fragment = decodeURIComponent(rawFragment);
    } catch {
      errors.push(`${sourcePath}: ${label} has malformed encoded anchor #${rawFragment} in ${targetPath}`);
      return;
    }
    if (!anchorsByPath.get(targetPath).has(fragment)) {
      errors.push(`${sourcePath}: ${label} resolves to missing anchor #${fragment} in ${targetPath}`);
    }
  };
  for (const [path, body] of pageBodies) {
    const outgoing = [];
    for (const m of body.matchAll(/\]\(((?:repo\([^)]+\):)?[^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      if (target.startsWith('#')) {
        checkAnchor(path, path, target.slice(1), 'same-page link');
        continue;
      }
      const crossRepo = /^repo\(([a-z0-9][a-z0-9._-]*)\):(.+)$/.exec(target);
      if (crossRepo) {
        const [, repository, repoPathWithAnchor] = crossRepo;
        const repoPath = repoPathWithAnchor.split('#')[0];
        if (!repoPath || repoPath.startsWith('/') || repoPath.includes('..')) {
          errors.push(`${path}: invalid cross-repo reference: ${target}`);
          continue;
        }
        const siblingRoot = resolve(root, '..', repository);
        const p = join(siblingRoot, repoPath);
        if (existsSync(siblingRoot) && !existsSync(p)) {
          warnings.push(`${path}: cross-repo reference missing in sibling checkout: ${target}`);
        }
        continue;
      }
      if (target.startsWith('repo:')) {
        const [repoPath, fragment] = target.slice('repo:'.length).split('#', 2);
        const p = join(root, repoPath);
        if (!existsSync(p)) errors.push(`${path}: repo: reference does not exist: ${target}`);
        else checkAnchor(path, repoPath, fragment, 'repo: reference');
        continue;
      }
      const [relativePath, fragment] = target.split('#', 2);
      const resolved = resolve(root, dirname(path), relativePath);
      if (!existsSync(resolved)) {
        errors.push(`${path}: relative link does not resolve: ${target}`);
      } else if (resolved.endsWith('.md') && relative(root, resolved).startsWith(GUIDE_DIR)) {
        const targetPath = relative(root, resolved);
        outgoing.push(targetPath);
        checkAnchor(path, targetPath, fragment, 'relative link');
      }
    }
    graph.set(path, outgoing);
  }
  return graph;
}

export function checkReachability(pages, graph, errors) {
  const seen = new Set([INDEX_PATH]);
  const queue = [INDEX_PATH];
  while (queue.length) {
    for (const next of graph.get(queue.shift()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const page of pages) {
    if (!seen.has(page)) errors.push(`${page}: not reachable from ${INDEX_PATH}`);
  }
}

// issues/20260809-guide-gap-npx-snapback-new-resolves-wrong-package: `npx
// snapback …` resolves the UNSCOPED registry name `snapback` — an unrelated
// third-party package with no `bin` — unless `@expo/snapback-cli` is already
// a dependency of the directory the reader is standing in. A guide page that
// offers the bare spelling before it has told the reader to install the
// scoped CLI hands an author `npm error could not determine executable to
// run` on their first command. The invariant is positional, not lexical: the
// bare bin may only appear after the page's first mention of the scoped
// package name.
const BARE_NPX_SNAPBACK = /npx\s+(?:-{1,2}[A-Za-z][\w-]*\s+)*snapback[\s`]/g;
const SCOPED_CLI_PACKAGE = '@expo/snapback-cli';

export function checkBootstrapResolvability(pageBodies, errors) {
  for (const [path, body] of pageBodies) {
    const scopedAt = body.indexOf(SCOPED_CLI_PACKAGE);
    BARE_NPX_SNAPBACK.lastIndex = 0;
    for (const match of body.matchAll(BARE_NPX_SNAPBACK)) {
      if (scopedAt !== -1 && match.index > scopedAt) continue;
      const line = body.slice(0, match.index).split('\n').length;
      errors.push(
        `${path}:${line}: \`${match[0].trim()}\` relies on the unscoped \`snapback\` bin ` +
          `before the page installs ${SCOPED_CLI_PACKAGE} — in a fresh directory npx resolves an ` +
          'unrelated registry package. Lead with `npm create snapback-app` or ' +
          `\`npx --yes ${SCOPED_CLI_PACKAGE}@latest new …\`.`,
      );
    }
  }
}

function parseTable(lines, startIdx) {
  const rows = [];
  let i = startIdx;
  while (i < lines.length && !lines[i].startsWith('|')) i += 1;
  i += 2; // header + separator
  for (; i < lines.length && lines[i].startsWith('|'); i += 1) {
    rows.push(lines[i].split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

export function parseCapabilityIndex(root, errors) {
  const text = readFileSync(join(root, CAPABILITIES_PATH), 'utf8');
  if (Buffer.byteLength(text) > CAPABILITIES_SIZE_BUDGET_BYTES) {
    errors.push(`${CAPABILITIES_PATH}: exceeds its size budget (${Buffer.byteLength(text)} > ${CAPABILITIES_SIZE_BUDGET_BYTES} bytes)`);
  }
  const lines = text.split('\n');
  const section = (heading) => lines.findIndex((l) => l.startsWith(heading));
  const capRows = parseTable(lines, section('## Capabilities'));
  const surfaceText = readFileSync(join(root, SURFACE_MAP_PATH), 'utf8');
  if (Buffer.byteLength(surfaceText) > SURFACE_MAP_SIZE_BUDGET_BYTES) {
    errors.push(`${SURFACE_MAP_PATH}: exceeds its size budget (${Buffer.byteLength(surfaceText)} > ${SURFACE_MAP_SIZE_BUDGET_BYTES} bytes)`);
  }
  const surfaceLines = surfaceText.split('\n');
  const surfaceSection = (heading) => surfaceLines.findIndex((l) => l.startsWith(heading));
  const routeRows = parseTable(surfaceLines, surfaceSection('## Server routes'));
  const hostOpRows = parseTable(surfaceLines, surfaceSection('## Host operations'));
  const capabilities = new Map();
  for (const row of capRows) {
    if (row.length !== 8) {
      errors.push(`${CAPABILITIES_PATH}: capability row has ${row.length} cells, expected 8: ${row[0] ?? '?'}`);
      continue;
    }
    const [id, what, aliases, targets, maturity, witness, authorities, page] = row;
    capabilities.set(id, { id, what, aliases, targets, maturity, witness, authorities, page });
  }
  const mapRows = (rows, label) => {
    const map = new Map();
    for (const row of rows) {
      if (row.length !== 2) {
        errors.push(`${SURFACE_MAP_PATH}: ${label} row needs 2 cells: ${row.join(' | ')}`);
        continue;
      }
      map.set(row[0], row[1]);
    }
    return map;
  };
  return {
    capabilities,
    routeMap: mapRows(routeRows, 'surface-map route'),
    hostOpMap: mapRows(hostOpRows, 'surface-map host-op'),
  };
}

export function extractRoutePaths(root, errors) {
  const paths = new Set();
  const sources = [
    ['crates/snapback-server/src/server.rs', ['core_route_registrations', 'system_route_registrations']],
    ['crates/snapback-server/src/admin.rs', ['admin_route_registrations']],
  ];
  for (const [file, fns] of sources) {
    const src = readFileSync(join(root, file), 'utf8');
    for (const fn of fns) {
      const start = src.search(new RegExp(`fn ${fn}\\(\\) -> Vec<RegisteredRoute> \\{`));
      if (start === -1) {
        errors.push(`route extraction failed: ${fn} not found in ${file} (the scan needs updating, not the registry)`);
        continue;
      }
      const body = src.slice(start, src.indexOf('\n}\n', start));
      let found = 0;
      for (const m of body.matchAll(/"(\/[^"]*)"/g)) {
        paths.add(m[1]);
        found += 1;
      }
      if (found === 0) errors.push(`route extraction found zero paths in ${fn} — scan broke`);
    }
  }
  if (paths.size < MIN_ROUTE_PATHS) {
    errors.push(`route extraction returned ${paths.size} paths (< ${MIN_ROUTE_PATHS}) — refusing a vacuous join`);
  }
  return paths;
}

export function extractHostOps(root, errors) {
  const src = readFileSync(join(root, 'crates/snapback-server/src/server.rs'), 'utf8');
  const ops = new Set(
    [...src.matchAll(/"(host_ops\.[a-zA-Z_]+(?:\.[a-zA-Z_]+)*)"/g)].map((m) => m[1]),
  );
  if (ops.size < MIN_HOST_OPS) {
    errors.push(`host-ops extraction returned ${ops.size} names (< ${MIN_HOST_OPS}) — refusing a vacuous join`);
  }
  return ops;
}

function gapRowDetails(capability) {
  if (!capability.page.startsWith('GAP')) return null;
  const review = capability.page.match(
    /owner:\s*([^,)]+),\s*review:\s*(\d{4}-\d{2}-\d{2})/u,
  );
  const pointer = capability.page.match(/\bissues\/[A-Za-z0-9._/-]+\.md\b/u)?.[0] ?? null;
  return {
    id: capability.id,
    owner: review?.[1].trim() ?? null,
    reviewDate: review?.[2] ?? null,
    pointer,
  };
}

export function capabilityGapRowsFromText(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## Capabilities'));
  return parseTable(lines, start)
    .filter((row) => row.length === 8 && row[7].startsWith('GAP'))
    .map(([id, what, aliases, targets, maturity, witness, authorities, page]) => (
      gapRowDetails({ id, what, aliases, targets, maturity, witness, authorities, page })
    ));
}

export function checkCapabilityGapRows(
  root,
  capabilities,
  errors,
  warnings,
  { today = new Date().toISOString().slice(0, 10) } = {},
) {
  const todayDay = Date.parse(`${today}T00:00:00Z`) / 86_400_000;
  for (const capability of capabilities.values()) {
    const gap = gapRowDetails(capability);
    if (!gap) continue;
    if (!gap.owner || !gap.reviewDate) {
      errors.push(
        `${CAPABILITIES_PATH}: GAP row '${gap.id}' must carry (owner: X, review: YYYY-MM-DD)`,
      );
    }
    if (!gap.pointer) {
      errors.push(`${CAPABILITIES_PATH}: GAP row '${gap.id}' must carry an issues/*.md link`);
    } else if (gap.pointer.startsWith('issues/closed/')) {
      errors.push(`${CAPABILITIES_PATH}: GAP row '${gap.id}' points at closed issue ${gap.pointer}`);
    } else if (!existsSync(join(root, gap.pointer))) {
      errors.push(`${CAPABILITIES_PATH}: GAP row '${gap.id}' points at missing issue ${gap.pointer}`);
    }
    if (!gap.reviewDate || !gap.owner || !gap.pointer) continue;
    const reviewDay = Date.parse(`${gap.reviewDate}T00:00:00Z`) / 86_400_000;
    const daysUntilReview = reviewDay - todayDay;
    if (daysUntilReview < 0) {
      warnings.push(
        `GAP REVIEW WARNING: row '${gap.id}' expired on ${gap.reviewDate}; `
          + `owner: ${gap.owner}; pointer: ${gap.pointer}`,
      );
    } else if (daysUntilReview <= GAP_REVIEW_WARNING_DAYS) {
      warnings.push(
        `GAP REVIEW WARNING: row '${gap.id}' expires within 7 days on ${gap.reviewDate}; `
          + `owner: ${gap.owner}; pointer: ${gap.pointer}`,
      );
    }
  }
}

export function checkCapabilityIndex(root, index, pageInfo, errors, warnings = []) {
  const { capabilities, routeMap, hostOpMap } = index;
  const claimedBy = new Map();
  for (const [path, info] of pageInfo) {
    for (const cap of info.frontmatter?.capabilities ?? []) {
      if (!capabilities.has(cap)) errors.push(`${path}: claims unknown capability '${cap}'`);
      if (!claimedBy.has(cap)) claimedBy.set(cap, []);
      claimedBy.get(cap).push({ path, info });
    }
  }
  // @ref LLP 0061#2-the-capability-index-registry-lite-with-witnesses —
  // every honest GAP has durable issue custody, not only an owner/date.
  checkCapabilityGapRows(root, capabilities, errors, warnings);
  for (const cap of capabilities.values()) {
    const gap = cap.page.startsWith('GAP');
    if (!gap) {
      const pagePath = join(GUIDE_DIR, cap.page);
      if (!pageInfo.has(pagePath)) {
        errors.push(`${CAPABILITIES_PATH}: '${cap.id}' points at missing page ${cap.page}`);
      } else if (!(claimedBy.get(cap.id) ?? []).some((c) => c.path === pagePath)) {
        errors.push(`${CAPABILITIES_PATH}: page ${cap.page} does not claim '${cap.id}' in its frontmatter`);
      }
    }
    if (cap.maturity !== 'design-only' && cap.witness.startsWith('—')) {
      errors.push(`${CAPABILITIES_PATH}: '${cap.id}' is ${cap.maturity} but has no witness`);
    }
    for (const { path, info } of claimedBy.get(cap.id) ?? []) {
      const pageRank = MATURITY_RANK[info.frontmatter?.maturity];
      if (pageRank !== undefined && pageRank > MATURITY_RANK[cap.maturity]) {
        errors.push(`${path}: page maturity '${info.frontmatter.maturity}' exceeds capability '${cap.id}' maturity '${cap.maturity}'`);
      }
    }
  }
  // Witness spot-validation: paths exist; routes exist in the extracted set.
  const routes = extractRoutePaths(root, errors);
  const hostOps = extractHostOps(root, errors);
  for (const cap of capabilities.values()) {
    const w = cap.witness;
    const route = w.match(/^route (\S+)/)?.[1];
    const symbol = w.match(/^`([^`]+)` in (\S+)/);
    if (route && !routes.has(route)) errors.push(`${CAPABILITIES_PATH}: witness route ${route} for '${cap.id}' not in the route registry`);
    if (symbol) {
      const [, sym, file] = symbol;
      if (!existsSync(join(root, file))) errors.push(`${CAPABILITIES_PATH}: witness file missing for '${cap.id}': ${file}`);
      else if (!readFileSync(join(root, file), 'utf8').includes(sym)) errors.push(`${CAPABILITIES_PATH}: witness symbol '${sym}' not found in ${file}`);
    }
    if (!route && !symbol && !w.startsWith('—') && !existsSync(join(root, w.split(' ')[0]))) {
      errors.push(`${CAPABILITIES_PATH}: witness path missing for '${cap.id}': ${w}`);
    }
  }
  // The joins: every enumerated surface classified, every classification live.
  const joins = [
    ['route', routes, routeMap],
    ['host-op', hostOps, hostOpMap],
  ];
  for (const [label, enumerated, map] of joins) {
    for (const entry of enumerated) {
      if (!map.has(entry)) errors.push(`${SURFACE_MAP_PATH}: ${label} '${entry}' is not classified in the surface map — map it to a capability or notAuthorFacing`);
    }
    for (const [entry, cls] of map) {
      if (!enumerated.has(entry)) errors.push(`${SURFACE_MAP_PATH}: surface map lists ${label} '${entry}' which no longer exists in the code`);
      if (!cls.startsWith('notAuthorFacing') && !capabilities.has(cls)) {
        errors.push(`${SURFACE_MAP_PATH}: ${label} '${entry}' maps to unknown capability '${cls}'`);
      }
    }
  }
  return { routes: routes.size, hostOps: hostOps.size };
}

function hashAuthorityEntries(authorities, entriesForAuthority) {
  const hash = createHash('sha256');
  hash.update('snapback-guide-reviewed-authorities.v1\0');
  for (const authority of [...new Set(authorities)].sort()) {
    hash.update('authority\0').update(authority).update('\0');
    const entries = entriesForAuthority(authority).sort((left, right) => (
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    ));
    if (entries.length === 0) hash.update('missing\0');
    for (const entry of entries) {
      hash.update('entry\0').update(entry.path).update('\0');
      hash.update(String(entry.bytes.byteLength)).update('\0');
      hash.update(entry.bytes).update('\0');
    }
  }
  return `sha256:${hash.digest('hex')}`;
}

function currentAuthorityEntries(root, authority) {
  const absolute = join(root, authority);
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!metadata.isDirectory()) {
    const bytes = metadata.isSymbolicLink()
      ? Buffer.from(readlinkSync(absolute))
      : readFileSync(absolute);
    return [{ path: authority, bytes }];
  }
  // Match Git's review history domain: tracked files plus non-ignored files
  // that can enter the pending review. Ignored build products do not make a
  // reviewed authority stale merely by appearing in a worktree.
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', authority],
    { cwd: root, maxBuffer: GIT_AUTHORITY_MAX_BUFFER },
  );
  return listed.toString('utf8').split('\0').filter(Boolean).flatMap((path) => {
    const absolutePath = join(root, path);
    // `git ls-files` retains tracked deletions. Omitting that absent entry
    // changes the directory digest, so deletion remains a freshness event
    // instead of turning the check into an informational filesystem error.
    let pathMetadata;
    try {
      pathMetadata = lstatSync(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return [{
      path,
      bytes: pathMetadata.isSymbolicLink()
        ? Buffer.from(readlinkSync(absolutePath))
        : readFileSync(absolutePath),
    }];
  });
}

function historicalAuthorityEntries(root, authority, revision) {
  const tree = execFileSync(
    'git',
    ['ls-tree', '-r', '-z', '--full-tree', revision, '--', authority],
    { cwd: root, maxBuffer: GIT_AUTHORITY_MAX_BUFFER },
  );
  return tree.toString('utf8').split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^[0-7]+ blob ([0-9a-f]+)\t(.+)$/s);
    if (!match) throw new Error(`unsupported git tree entry for '${authority}': ${record}`);
    return {
      path: match[2],
      bytes: execFileSync('git', ['cat-file', 'blob', match[1]], {
        cwd: root,
        maxBuffer: GIT_AUTHORITY_MAX_BUFFER,
      }),
    };
  });
}

// @ref LLP 0232#d-2-prepared-execution-and-rebase-stable-records — a page review is bound to the authority bytes that were
// actually reviewed, never to the checkout's moving commit identity.
export function authoritiesDigest(root, authorities) {
  return hashAuthorityEntries(
    authorities,
    (authority) => currentAuthorityEntries(root, authority),
  );
}

export function authoritiesDigestAtRevision(root, authorities, revision) {
  const commit = execFileSync(
    'git',
    ['rev-parse', '--verify', `${revision}^{commit}`],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  return hashAuthorityEntries(
    authorities,
    (authority) => historicalAuthorityEntries(root, authority, commit),
  );
}

export function checkFreshness(root, pageInfo, warnings, infos) {
  for (const [path, info] of pageInfo) {
    const reviewedDigest = info.frontmatter?.['reviewed-authorities-digest'];
    if (!reviewedDigest) continue;
    const authorities = info.frontmatter?.authorities ?? [];
    if (authorities.length === 0) continue;
    try {
      const currentDigest = authoritiesDigest(root, authorities);
      if (currentDigest !== reviewedDigest) {
        warnings.push(
          `${path}: authorities changed since review at ${reviewedDigest.slice(0, 17)}… `
          + `(current ${currentDigest.slice(0, 17)}…)`,
        );
      }
    } catch (error) {
      const message = `${path}: could not compute authority freshness: ${error.message}`;
      if (error.code === 'ENOENT') infos.push(message);
      else warnings.push(message);
    }
  }
}

export function buildManifest(root, pageInfo, snippetRecords, index, surfaces) {
  const publishedClosureRecord = loadPublishedClosure(root, []);
  const pages = {};
  const nav = new Map();
  for (const [path, info] of [...pageInfo.entries()].sort()) {
    const fm = info.frontmatter ?? {};
    pages[fm.id ?? path] = {
      path,
      title: fm.title,
      order: Number(fm.order ?? 0),
      status: fm.status,
      targets: fm.targets,
      maturity: fm.maturity,
      since: fm.since,
      unreleased: fm.unreleased === 'true' ? true : undefined,
      capabilities: fm.capabilities,
      authorities: fm.authorities,
      examples: fm.examples,
      reviewed: fm.reviewed,
      reviewedAuthoritiesDigest: fm['reviewed-authorities-digest'],
      sha256: createHash('sha256').update(info.raw).digest('hex'),
      snippets: snippetRecords.get(path) ?? [],
    };
    const section = dirname(relative(root, join(root, path))).split('/')[1] ?? '.';
    if (!nav.has(section)) nav.set(section, []);
    nav.get(section).push({ id: fm.id, order: Number(fm.order ?? 0), title: fm.title });
  }
  for (const entries of nav.values()) entries.sort((a, b) => a.order - b.order);
  const covered = [];
  const gaps = [];
  for (const cap of index.capabilities.values()) {
    (cap.page.startsWith('GAP') ? gaps : covered).push(cap.id);
  }
  const registryBytes = readFileSync(join(root, SYMBOL_REGISTRY_PATH));
  const registry = JSON.parse(registryBytes);
  const diagnosticsBytes = readFileSync(join(root, DIAGNOSTICS_REGISTRY_PATH));
  const diagnostics = JSON.parse(diagnosticsBytes);
  const manifest = {
    schemaVersion: 'snapback-guide.v1',
    generatedBy: 'scripts/generate-guide-manifest.mjs',
    buildIdentity: { sourceDigest: null },
    publishedClosure: {
      scope: publishedClosureRecord?.scope,
      newestPublished: publishedClosureRecord?.newestPublished,
    },
    nav: Object.fromEntries([...nav.entries()].sort()),
    pages,
    // @ref LLP 0194#design — non-Markdown reference bytes participate in the
    // same manifest and build identity; projection flags turn true only with
    // an implemented native carrier and its acceptance coverage.
    resources: {
      'reference.symbol-registry': {
        path: SYMBOL_REGISTRY_PATH,
        title: 'Build-bound public API symbol registry',
        mediaType: 'application/json',
        bytes: registryBytes.byteLength,
        sha256: createHash('sha256').update(registryBytes).digest('hex'),
        uri: 'snapback-guide://reference/registry',
        servedPath: '/_snapback/guide/reference/registry.json',
        projections: { http: true, mcp: true, llms: true },
        schemaVersion: registry.schemaVersion,
        sourceDigest: registry.buildIdentity?.sourceDigest,
        modules: registry.modules?.length ?? 0,
        symbols: registry.symbols?.length ?? 0,
      },
      'reference.diagnostics-registry': {
        path: DIAGNOSTICS_REGISTRY_PATH,
        title: 'Build-bound diagnostic code registry',
        mediaType: 'application/json',
        bytes: diagnosticsBytes.byteLength,
        sha256: createHash('sha256').update(diagnosticsBytes).digest('hex'),
        uri: 'snapback-guide://reference/diagnostics',
        servedPath: '/_snapback/guide/reference/diagnostics-registry.json',
        projections: { http: true, mcp: true, llms: true },
        schemaVersion: diagnostics.schemaVersion,
        sourceDigest: diagnostics.buildIdentity?.sourceDigest,
        codes: diagnostics.counts?.codes ?? 0,
        emittingSites: diagnostics.counts?.emittingSites ?? 0,
      },
    },
    capabilities: { covered: covered.sort(), gaps: gaps.sort() },
    surfaces,
  };
  const wholeFlat = buildFlatGuide(root, manifest, pageInfo);
  const sectionFlats = buildSectionFlatGuides(root, manifest, pageInfo);
  manifest.flatProjections = {
    whole: {
      path: FLAT_PATH,
      servedPath: '/_snapback/guide/flat.md',
      uri: GUIDE_MCP_FLAT_URI,
      bytes: Buffer.byteLength(wholeFlat),
      sha256: createHash('sha256').update(wholeFlat).digest('hex'),
    },
    sections: Object.fromEntries(
      [...sectionFlats.entries()].map(([section, projection]) => [section, {
        path: projection.path,
        servedPath: `/_snapback/guide/${projection.path.slice(`${GUIDE_DIR}/`.length)}`,
        uri: `${GUIDE_MCP_FLAT_SECTION_URI_PREFIX}${section}`,
        bytes: Buffer.byteLength(projection.content),
        sha256: createHash('sha256').update(projection.content).digest('hex'),
      }]),
    ),
  };
  manifest.contentHash = createHash('sha256')
    .update(wholeFlat)
    .update('\0guide-resource\0')
    .update(SYMBOL_REGISTRY_PATH)
    .update('\0')
    .update(registryBytes)
    .update('\0guide-resource\0')
    .update(DIAGNOSTICS_REGISTRY_PATH)
    .update('\0')
    .update(diagnosticsBytes)
    .digest('hex');
  manifest.buildIdentity.sourceDigest = `sha256:${manifest.contentHash}`;
  return manifest;
}

/// Build the one-request projection in manifest nav order. The capability
/// index is deliberately first even though it also participates in the nav;
/// every remaining page appears exactly once.
///
/// @ref LLP 0061#4-distribution-and-discovery — served-guide §4a:
/// capability index first, then every guide page in manifest nav order.
function renderFlatGuide(pageIds, pageInfo, label) {
  const byId = new Map(
    [...pageInfo.entries()].map(([path, info]) => [info.frontmatter?.id, { path, raw: info.raw }]),
  );
  const sections = [
    `<!-- Generated ${label} by scripts/generate-guide-manifest.mjs. Never hand-edit. -->`,
  ];
  for (const id of pageIds) {
    const page = byId.get(id);
    if (!page) throw new Error(`manifest nav refers to missing guide page id '${id}'`);
    sections.push(`<!-- snapback-guide-source: ${page.path} -->\n${page.raw.trimEnd()}`);
  }
  return `${sections.join('\n\n---\n\n')}\n`;
}

export function buildFlatGuide(root, manifest, pageInfo) {
  const navIds = Object.values(manifest.nav).flat().map((entry) => entry.id);
  const orderedIds = [
    'meta.capabilities',
    ...navIds.filter((id) => id !== 'meta.capabilities'),
  ];
  return renderFlatGuide(orderedIds, pageInfo, 'whole-corpus flat projection');
}

/// Build one bounded projection for every top-level manifest navigation
/// section. The manifest supplies both membership and order; `meta` is the
/// stable public name for the root (`.`) section.
///
/// @ref LLP 0061#4-distribution-and-discovery — context-limited readers use
/// section flats while every carrier preserves the common Guide identity.
export function buildSectionFlatGuides(root, manifest, pageInfo) {
  const projections = new Map();
  for (const [navSection, entries] of Object.entries(manifest.nav)) {
    const section = flatSectionName(navSection);
    if (projections.has(section)) throw new Error(`duplicate guide flat section '${section}'`);
    projections.set(section, {
      path: flatSectionPath(section),
      content: renderFlatGuide(
        entries.map((entry) => entry.id),
        pageInfo,
        `${section} section flat projection`,
      ),
    });
  }
  return projections;
}

export function loadCorpus(root) {
  const errors = [];
  const warnings = [];
  const infos = [];
  const pagePaths = listGuidePages(root);
  const pageInfo = new Map();
  const pageBodies = new Map();
  for (const path of pagePaths) {
    const raw = readFileSync(join(root, path), 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw, path, errors);
    if (frontmatter) {
      validateFrontmatter(frontmatter, path, errors);
      validateTargetBanner(frontmatter, body, path, errors);
    }
    for (const field of ['authorities', 'examples']) {
      for (const ref of frontmatter?.[field] ?? []) {
        if (!existsSync(join(root, ref))) {
          errors.push(`${path}: ${field} path does not exist: ${ref}${missingDemoArtifactHint(ref)}`);
        }
      }
    }
    pageInfo.set(path, { frontmatter, raw });
    pageBodies.set(path, body);
  }
  return { errors, warnings, infos, pagePaths, pageInfo, pageBodies };
}

// Rebuild the committed guide projections in memory. This is the cheap,
// read-only inventory seam: no generated files are written and no snippets are
// executed (transclusions are compared as bytes only).
export function auditGuideManifestInventory({
  root = repoRoot(),
  readGeneratedFile = (path) => readFileSync(join(root, path), 'utf8'),
} = {}) {
  const registryErrors = [];
  try {
    execFileSync(
      process.execPath,
      [join(root, 'scripts/generate-diagnostics-registry.mjs'), '--check'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    execFileSync(
      process.execPath,
      [join(root, 'scripts/generate-symbol-registry.mjs'), '--check'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    registryErrors.push(`reference-registry inventory failed${detail ? `: ${detail}` : ''}`);
  }
  const { errors, pagePaths, pageInfo, pageBodies } = loadCorpus(root);
  errors.push(...registryErrors);
  const snippetRecords = checkSnippets(root, pageBodies, errors);
  const index = parseCapabilityIndex(root, errors);
  const surfaces = checkCapabilityIndex(root, index, pageInfo, errors);
  checkPublishedClosure(root, pageInfo, pageBodies, errors);
  if (errors.length > 0) {
    return { errors, stale: [], pageCount: pagePaths.length, snippetCount: 0 };
  }

  const expected = buildManifest(root, pageInfo, snippetRecords, index, surfaces);
  const expectedFlat = buildFlatGuide(root, expected, pageInfo);
  const expectedSectionFlats = buildSectionFlatGuides(root, expected, pageInfo);
  const stale = [];
  try {
    const actual = JSON.parse(readGeneratedFile(MANIFEST_PATH));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      stale.push(MANIFEST_PATH);
    }
  } catch {
    stale.push(MANIFEST_PATH);
  }
  try {
    if (readGeneratedFile(FLAT_PATH) !== expectedFlat) stale.push(FLAT_PATH);
  } catch {
    stale.push(FLAT_PATH);
  }
  for (const { path, content } of expectedSectionFlats.values()) {
    try {
      if (readGeneratedFile(path) !== content) stale.push(path);
    } catch {
      stale.push(path);
    }
  }
  const expectedSectionPaths = new Set(
    [...expectedSectionFlats.values()].map(({ path }) => path),
  );
  for (const path of listFlatSectionPaths(root)) {
    if (!expectedSectionPaths.has(path)) stale.push(path);
  }
  return {
    errors,
    stale,
    pageCount: pagePaths.length,
    snippetCount: [...snippetRecords.values()].flat().length,
  };
}

// Recorded benchmark harness transcripts are frozen evidence of what a model
// typed under test, not authored examples. The raw-client asset-accessor
// sweep keeps authored files on createAssetClient and skips this class.
export function isRecordedBenchmarkEventsTranscript(path) {
  if (!path.startsWith('benchmarks/runs/') || !path.endsWith('.jsonl')) {
    return false;
  }
  const marker = '/events/';
  const eventsAt = path.lastIndexOf(marker);
  if (eventsAt <= 'benchmarks/runs'.length) {
    return false;
  }
  const afterEvents = path.slice(eventsAt + marker.length);
  return afterEvents.length > 0 && !afterEvents.includes('/');
}
