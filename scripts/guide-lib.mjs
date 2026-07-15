// Shared logic for the Snapback Guide corpus checks and manifest generator.
// @ref LLP 0061#3-verification-snippets-that-ran — transclusion-match snippets,
// consistency joins, reviewed-commit freshness, manifest as the projection interface.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const GUIDE_DIR = 'guide';
export const MANIFEST_PATH = join(GUIDE_DIR, 'guide-manifest.generated.json');
export const CAPABILITIES_PATH = join(GUIDE_DIR, 'capabilities.md');
export const INDEX_PATH = join(GUIDE_DIR, 'index.md');
const CLASSED_LANGS = new Set(['js', 'mjs', 'ts', 'tsx', 'json', 'contract']);
const MATURITY_RANK = { 'design-only': 0, partial: 1, shipped: 2 };
const CAPABILITIES_SIZE_BUDGET_BYTES = 32768;
// Vacuous-pass guards for the source scans: extraction returning fewer
// entries than these floors means the scan broke, not that surface shrank.
const MIN_ROUTE_PATHS = 50;
const MIN_HOST_OPS = 10;

export function repoRoot() {
  return resolve(dirname(new URL(import.meta.url).pathname), '..');
}

export function listGuidePages(root) {
  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== 'eval-runs') walk(path);
      } else if (entry.endsWith('.md')) {
        pages.push(relative(root, path));
      }
    }
  };
  walk(join(root, GUIDE_DIR));
  return pages;
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
  'examples', 'status', 'targets', 'maturity', 'reviewed', 'reviewed-commit',
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
  check('reviewed', /^\d{4}-\d{2}-\d{2}$/.test(fm.reviewed ?? ''), 'must be YYYY-MM-DD');
  check('reviewed-commit', /^([0-9a-f]{7,40}|HEAD)$/.test(fm['reviewed-commit'] ?? ''), "must be a commit sha or 'HEAD'");
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
        errors.push(`${path}:${fence.line}: snippet source does not exist: ${source}`);
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
  const exactRoot = resolve(root, '..', 'exact');
  for (const [path, body] of pageBodies) {
    const outgoing = [];
    for (const m of body.matchAll(/\]\((repo\(exact\):[^)\s]+|[^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      if (target.startsWith('repo(exact):')) {
        const p = join(exactRoot, target.slice('repo(exact):'.length));
        if (existsSync(exactRoot) && !existsSync(p)) {
          warnings.push(`${path}: cross-repo reference missing in sibling checkout: ${target}`);
        }
        continue;
      }
      if (target.startsWith('repo:')) {
        const p = join(root, target.slice('repo:'.length).split('#')[0]);
        if (!existsSync(p)) errors.push(`${path}: repo: reference does not exist: ${target}`);
        continue;
      }
      const resolved = resolve(root, dirname(path), target.split('#')[0]);
      if (!existsSync(resolved)) {
        errors.push(`${path}: relative link does not resolve: ${target}`);
      } else if (resolved.endsWith('.md') && relative(root, resolved).startsWith(GUIDE_DIR)) {
        outgoing.push(relative(root, resolved));
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
  const routeRows = parseTable(lines, section('### Server routes'));
  const hostOpRows = parseTable(lines, section('### Host operations'));
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
        errors.push(`${CAPABILITIES_PATH}: ${label} row needs 2 cells: ${row.join(' | ')}`);
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
    ['src/server.rs', ['core_route_registrations', 'system_route_registrations']],
    ['src/admin.rs', ['admin_route_registrations']],
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
  const src = readFileSync(join(root, 'src/server.rs'), 'utf8');
  const ops = new Set(
    [...src.matchAll(/"(host_ops\.[a-zA-Z_]+(?:\.[a-zA-Z_]+)*)"/g)].map((m) => m[1]),
  );
  if (ops.size < MIN_HOST_OPS) {
    errors.push(`host-ops extraction returned ${ops.size} names (< ${MIN_HOST_OPS}) — refusing a vacuous join`);
  }
  return ops;
}

export function checkCapabilityIndex(root, index, pageInfo, errors) {
  const { capabilities, routeMap, hostOpMap } = index;
  const today = new Date().toISOString().slice(0, 10);
  const claimedBy = new Map();
  for (const [path, info] of pageInfo) {
    for (const cap of info.frontmatter?.capabilities ?? []) {
      if (!capabilities.has(cap)) errors.push(`${path}: claims unknown capability '${cap}'`);
      if (!claimedBy.has(cap)) claimedBy.set(cap, []);
      claimedBy.get(cap).push({ path, info });
    }
  }
  for (const cap of capabilities.values()) {
    const gap = cap.page.startsWith('GAP');
    if (gap) {
      const m = cap.page.match(/owner:\s*([^,)]+),\s*review:\s*(\d{4}-\d{2}-\d{2})/);
      if (!m) {
        errors.push(`${CAPABILITIES_PATH}: GAP row '${cap.id}' must carry (owner: X, review: YYYY-MM-DD)`);
      } else if (m[2] < today) {
        errors.push(`${CAPABILITIES_PATH}: GAP row '${cap.id}' review date ${m[2]} has expired`);
      }
    } else {
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
      if (!map.has(entry)) errors.push(`${CAPABILITIES_PATH}: ${label} '${entry}' is not classified in the surface map — map it to a capability or notAuthorFacing`);
    }
    for (const [entry, cls] of map) {
      if (!enumerated.has(entry)) errors.push(`${CAPABILITIES_PATH}: surface map lists ${label} '${entry}' which no longer exists in the code`);
      if (!cls.startsWith('notAuthorFacing') && !capabilities.has(cls)) {
        errors.push(`${CAPABILITIES_PATH}: ${label} '${entry}' maps to unknown capability '${cls}'`);
      }
    }
  }
  return { routes: routes.size, hostOps: hostOps.size };
}

export function checkFreshness(root, pageInfo, warnings, infos) {
  let head = null;
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    infos.push('freshness: git unavailable; skipping drift report');
    return;
  }
  for (const [path, info] of pageInfo) {
    const pinned = info.frontmatter?.['reviewed-commit'];
    if (!pinned) continue;
    if (pinned === 'HEAD') {
      infos.push(`${path}: reviewed-commit is unpinned (HEAD) — pin it in the landing change`);
      continue;
    }
    const authorities = info.frontmatter?.authorities ?? [];
    if (authorities.length === 0) continue;
    try {
      const changed = execFileSync(
        'git',
        ['diff', '--name-only', `${pinned}..${head}`, '--', ...authorities],
        { cwd: root, encoding: 'utf8' },
      ).trim();
      if (changed) {
        warnings.push(`${path}: authorities changed since review at ${pinned.slice(0, 10)}: ${changed.split('\n').join(', ')}`);
      }
    } catch {
      warnings.push(`${path}: reviewed-commit ${pinned} is unknown to git — re-pin it`);
    }
  }
}

export function buildManifest(root, pageInfo, snippetRecords, index, surfaces) {
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
      capabilities: fm.capabilities,
      authorities: fm.authorities,
      examples: fm.examples,
      reviewed: fm.reviewed,
      reviewedCommit: fm['reviewed-commit'],
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
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    // buildIdentity stays 'unknown' outside a git checkout.
  }
  return {
    schemaVersion: 'snapback-guide.v1',
    generatedBy: 'scripts/generate-guide-manifest.mjs',
    buildIdentity: { commit },
    nav: Object.fromEntries([...nav.entries()].sort()),
    pages,
    capabilities: { covered: covered.sort(), gaps: gaps.sort() },
    surfaces,
  };
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
    if (frontmatter) validateFrontmatter(frontmatter, path, errors);
    for (const field of ['authorities', 'examples']) {
      for (const ref of frontmatter?.[field] ?? []) {
        if (!existsSync(join(root, ref))) errors.push(`${path}: ${field} path does not exist: ${ref}`);
      }
    }
    pageInfo.set(path, { frontmatter, raw });
    pageBodies.set(path, body);
  }
  return { errors, warnings, infos, pagePaths, pageInfo, pageBodies };
}
