import {
  basename as pathBasename,
  dirname as pathDirname,
  extname as pathExtname,
  join as pathJoin,
  normalize as pathNormalize,
} from 'node:path/posix';

// @ref LLP 0193#program — source-site classification keeps environment names,
// protocol vocabulary, reservations, and real emissions distinct in D1's
// complete inventory instead of relying on a raw SNAPBACK_* token sweep.
export const DIAGNOSTIC_CODE_PATTERN = /(?<![A-Z0-9_])SNAPBACK_[A-Z0-9_]*[A-Z0-9](?![A-Z0-9_])/gu;
export const DIAGNOSTICS_RUST_PRODUCTION_ROOTS = Object.freeze([
  'crates/snapback/src/',
  'crates/snapback-kernel/src/',
  'crates/snapback-types/src/',
  'crates/snapback-auth/src/',
  'crates/snapback-activation/src/',
  'crates/snapback-runtime/src/',
  'crates/snapback-services/src/',
  'crates/snapback-sync/src/',
  'crates/snapback-engine/src/',
  'crates/snapback-conformance/src/',
  'crates/snapback-harness/src/',
  'crates/snapback-tools/src/',
  'crates/snapback-server/src/',
  'crates/snapback-cli/src/',
]);
export const DIAGNOSTICS_PRODUCTION_ROOTS = Object.freeze([
  ...DIAGNOSTICS_RUST_PRODUCTION_ROOTS,
  'packages/',
  'targets/',
  'clients/swift/',
]);

function rustExternalModuleDeclarations(source, inheritedTestOnly) {
  const literals = stringLiteralBounds(source, { ordinaryMultiline: true });
  const declarations = [];
  const pattern = /^((?:(?:[ \t]*#\s*\[[^\]\r\n]+\](?:[ \t]+|\r?\n|$))|(?:[ \t]*\/\/[^\r\n]*(?:\r?\n|$)))*)[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gmu;
  for (const declaration of source.matchAll(pattern)) {
    const marker = declaration.index + declaration[0].lastIndexOf('mod');
    if (!codeOffset(marker, literals)) continue;
    const attributes = declaration[1].replace(/^[ \t]*\/\/[^\r\n]*/gmu, '');
    const cfgTest = /#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/u.test(attributes);
    const cfgNotTest = /#\s*\[\s*cfg\s*\(\s*not\s*\(\s*test\s*\)\s*\)\s*\]/u.test(attributes);
    if ((!inheritedTestOnly && !cfgTest) || (inheritedTestOnly && cfgNotTest)) continue;
    const explicitPath = attributes.match(/#\s*\[\s*path\s*=\s*"([^"]+)"\s*\]/u)?.[1];
    declarations.push({ explicitPath, name: declaration[2] });
  }
  return declarations;
}

function rustDefaultModuleBase(path) {
  const filename = pathBasename(path);
  return /^(?:lib|main|mod|build)\.rs$/u.test(filename)
    ? pathDirname(path)
    : pathJoin(pathDirname(path), filename.slice(0, -pathExtname(filename).length));
}

// Follow cfg(test)-gated external module declarations instead of guessing
// test ownership from filenames. Once a test-only file is reached, its own
// ordinary external modules inherit that test-only compilation context.
export function rustExternalTestModulePaths(entryPaths, { pathExists, readSource }) {
  const discovered = new Set();
  const queued = new Set(entryPaths.map((path) => `production\0${path}`));
  const queue = entryPaths.map((path) => ({ path, testOnly: false }));
  for (let index = 0; index < queue.length; index += 1) {
    const { path, testOnly } = queue[index];
    for (const declaration of rustExternalModuleDeclarations(readSource(path), testOnly)) {
      const candidates = declaration.explicitPath === undefined
        ? [
          pathJoin(rustDefaultModuleBase(path), `${declaration.name}.rs`),
          pathJoin(rustDefaultModuleBase(path), declaration.name, 'mod.rs'),
        ]
        : [pathNormalize(pathJoin(pathDirname(path), declaration.explicitPath))];
      const resolved = candidates.find(pathExists);
      if (resolved === undefined) continue;
      discovered.add(resolved);
      const testQueueKey = `test\0${resolved}`;
      if (!queued.has(testQueueKey)) {
        queued.add(testQueueKey);
        queue.push({ path: resolved, testOnly: true });
      }
    }
  }
  return [...discovered].sort();
}
const REFERENCE_ONLY_MARKER = 'diagnostics-registry: reference-only';
const RESERVED_MARKER = 'diagnostics-registry: reserved';
const RECEIVED_MARKER = 'diagnostics-registry: received';
const EMISSION_MARKER = 'diagnostics-registry: emission';
const ENVIRONMENT_MARKER = 'diagnostics-registry: environment';

function lineBounds(source, offset) {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  const nextNewline = source.indexOf('\n', offset);
  return { start, end: nextNewline === -1 ? source.length : nextNewline };
}

function lineHasNamedSiteMarker(source, bounds, marker, code) {
  const markerPattern = new RegExp(
    `${escapeRegExp(marker)}\\s+${escapeRegExp(code)}(?![A-Z0-9_])`,
    'u',
  );
  return source.slice(bounds.start, bounds.end).match(markerPattern);
}

function lineContainsCode(source, bounds, code) {
  return new RegExp(
    `(?<![A-Z0-9_])${escapeRegExp(code)}(?![A-Z0-9_])`,
    'u',
  ).test(source.slice(bounds.start, bounds.end));
}

function hasSiteMarker(source, offset, marker, code) {
  const current = lineBounds(source, offset);
  const currentMarker = lineHasNamedSiteMarker(source, current, marker, code);
  if (currentMarker !== null) {
    const markerCodeOffset = current.start + currentMarker.index
      + currentMarker[0].lastIndexOf(code);
    const next = current.end === source.length
      ? null
      : lineBounds(source, current.end + 1);
    // A preceding marker names its target. Do not also publish the marker's
    // comment token when the named spelling occurs on the immediately next
    // line; the next-line site is the one retained in the registry.
    if (
      offset === markerCodeOffset
      && (
        lineContainsCode(source, { start: current.start, end: markerCodeOffset }, code)
        || (next !== null && lineContainsCode(source, next, code))
      )
    ) return false;
    return true;
  }
  if (current.start === 0) return false;
  const previous = lineBounds(source, current.start - 1);
  return lineHasNamedSiteMarker(source, previous, marker, code) !== null;
}

function hasReferenceOnlyMarker(source, offset) {
  const current = lineBounds(source, offset);
  if (source.slice(current.start, current.end).includes(REFERENCE_ONLY_MARKER)) return true;
  if (current.start === 0) return false;
  const previous = lineBounds(source, current.start - 1);
  return source.slice(previous.start, previous.end).includes(REFERENCE_ONLY_MARKER);
}

function hasReservedMarker(source, offset, code) {
  return hasSiteMarker(source, offset, RESERVED_MARKER, code);
}

function hasReceivedMarker(source, offset, code) {
  return hasSiteMarker(source, offset, RECEIVED_MARKER, code);
}

function hasEmissionMarker(source, offset, code) {
  return hasSiteMarker(source, offset, EMISSION_MARKER, code);
}

function hasEnvironmentMarker(source, offset, code) {
  return hasSiteMarker(source, offset, ENVIRONMENT_MARKER, code);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const LANGUAGE_KEYWORDS = new Set([
  // JavaScript (including contextual declaration/control words that the
  // permissive helper recognizer must never treat as method names).
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'from', 'function', 'get',
  'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'of', 'return',
  'set', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield',
  // Rust and Swift control/declaration words that fit the same identifier
  // grammar and occur in the mixed-language classifier fixtures.
  'crate', 'defer', 'dyn', 'extern', 'fallthrough', 'fn', 'func', 'guard',
  'impl', 'init', 'is', 'loop', 'match', 'mod', 'move', 'mut', 'nil', 'open',
  'operator', 'private', 'protocol', 'pub', 'public', 'ref', 'repeat',
  'rethrows', 'self', 'struct', 'subscript', 'trait', 'type', 'typealias',
  'unsafe', 'use', 'where',
]);

function isLanguageKeyword(identifier) {
  return LANGUAGE_KEYWORDS.has(identifier);
}

function isEnvironmentIdentifier(identifier) {
  return (
    /^(?:env|environment)$/u.test(identifier)
    || /(?:Env|Environment)$/u.test(identifier)
    || /(?:^|_)(?:ENV|ENVIRONMENT)(?:_|$)/u.test(identifier)
    || /(?:env|environment)(?:[A-Z]|$)/u.test(identifier)
  );
}

function environmentMutationOperator(after) {
  return /^\s*(?:=(?!=|>)|\?\?=|\|\|=|&&=|\+=|-=|\*=|\/=|%=)/u.test(after);
}

const GENERIC_ENVIRONMENT_OBJECT_ACCESS = String.raw`(?:(?:[A-Za-z_$][\w$]*\.)*(?:env|environment)|[A-Za-z_$][\w$]*(?:Env|Environment))`;

function genericEnvironmentObjectProperty(before, { deleted = false, bracket = false } = {}) {
  const deletePrefix = deleted ? String.raw`\bdelete\s+` : '';
  const propertySuffix = bracket
    ? String.raw`(?:\?\.)?\[\s*["']$`
    : String.raw`(?:\.|\?\.)$`;
  return new RegExp(
    `${deletePrefix}${GENERIC_ENVIRONMENT_OBJECT_ACCESS}${propertySuffix}`,
    'u',
  ).test(before);
}

function directEnvironmentSiteKind(source, offset, code) {
  const before = source.slice(Math.max(0, offset - 256), offset);
  const after = source.slice(offset + code.length, offset + code.length + 128);

  if (
    /\.env_remove\s*\(\s*["']$/u.test(before)
    || /\b(?:std::)?env::remove_var\s*\(\s*(?:r#*)?["']$/u.test(before)
    || /\bdelete\s+(?:process|Bun)\.env(?:\.|\?\.)$/u.test(before)
    || genericEnvironmentObjectProperty(before, { deleted: true })
    || (
      /\bdelete\s+(?:process|Bun)\.env(?:\?\.)?\[\s*["']$/u.test(before)
      && /^["']\s*\]/u.test(after)
    )
    || (
      genericEnvironmentObjectProperty(before, { deleted: true, bracket: true })
      && /^["']\s*\]/u.test(after)
    )
  ) return 'remove';

  if (
    /\.env\s*\(\s*["']$/u.test(before)
    || /\b(?:std::)?env::set_var\s*\(\s*(?:r#*)?["']$/u.test(before)
    || (
      /\b(?:process|Bun)\.env(?:\.|\?\.)$/u.test(before)
      && environmentMutationOperator(after)
    )
    || (
      /\b(?:process|Bun)\.env(?:\?\.)?\[\s*["']$/u.test(before)
      && /^["']\s*\]/u.test(after)
      && environmentMutationOperator(after.replace(/^["']\s*\]/u, ''))
    )
    || (
      genericEnvironmentObjectProperty(before)
      && environmentMutationOperator(after)
    )
    || (
      genericEnvironmentObjectProperty(before, { bracket: true })
      && /^["']\s*\]/u.test(after)
      && environmentMutationOperator(after.replace(/^["']\s*\]/u, ''))
    )
  ) return 'write';

  // Rust: compile-time env macros, std::env::var(_os), env::var(_os), and
  // imported var_os.
  if (/(?:\b(?:option_env!|env!)|\b(?:std::)?env::(?:var|var_os)|\bvar_os)\s*\(\s*(?:r#*)?["']$/u.test(before)) {
    return 'read';
  }

  // JavaScript/Swift: direct process/Bun/Deno access, injected env objects,
  // env helper calls, and bracket access through an env/environment binding.
  return (
    /\b(?:process|Bun)\.env(?:\.|\?\.)$/u.test(before)
    || /\b(?:process|Bun)\.env(?:\?\.)?\[\s*["']$/u.test(before)
    || /\bDeno\.env\.(?:get|has)\s*\(\s*["']$/u.test(before)
    || /\bprocess\.env\)\s*\.$/u.test(before)
    || /\b(?:[A-Za-z_$][\w$]*\.)*(?:env|environment)(?:\.|\?\.)$/u.test(before)
    || /\b[A-Za-z_$][\w$]*(?:Env|Environment)(?:\.|\?\.)$/u.test(before)
    || /\b(?:[A-Za-z_$][\w$]*\.)*(?:env|environment)(?:\?\.)?\[\s*["']$/u.test(before)
    || /\b[A-Za-z_$][\w$]*(?:Env|Environment)(?:\?\.)?\[\s*["']$/u.test(before)
    || /\b(?:env|environment)\s*\(\s*["']$/u.test(before)
  ) ? 'read' : null;
}

function javaScriptEnvironmentObjectKind(source, offset, code, literals) {
  const after = source.slice(offset + code.length, offset + code.length + 16);
  if (!/^\s*:/u.test(after)) return null;

  const contextStart = Math.max(0, offset - 4096);
  const context = source.slice(contextStart, offset);
  const candidates = [];
  for (const assignment of context.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\s*\()?\s*\{/gu,
  )) {
    if (isEnvironmentIdentifier(assignment[1])) {
      candidates.push({
        kind: 'write',
        open: contextStart + assignment.index + assignment[0].lastIndexOf('{'),
      });
    }
  }
  for (const property of context.matchAll(/\b(?:env|environment)\s*:\s*\{/gu)) {
    candidates.push({
      kind: 'write',
      open: contextStart + property.index + property[0].lastIndexOf('{'),
    });
  }
  for (const helper of context.matchAll(
    /\b(?:stageSecrets|setSecrets)\s*\([^{}]*\{/gu,
  )) {
    candidates.push({
      kind: 'write',
      open: contextStart + helper.index + helper[0].lastIndexOf('{'),
    });
  }
  for (const helper of context.matchAll(
    /\bflyctl\s*\([^{}]*["']secrets["'][^{}]*\{/gu,
  )) {
    candidates.push({
      kind: 'write',
      open: contextStart + helper.index + helper[0].lastIndexOf('{'),
    });
  }
  for (const returned of context.matchAll(/\breturn\s*\{/gu)) {
    const open = contextStart + returned.index + returned[0].lastIndexOf('{');
    const beforeReturn = source.slice(Math.max(0, open - 4096), open);
    const functions = [...beforeReturn.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/gu)];
    if (isEnvironmentIdentifier(functions.at(-1)?.[1] ?? '')) {
      candidates.push({ kind: 'write', open });
    }
  }
  return candidates.sort((left, right) => right.open - left.open)
    .find(({ open }) => matchingDelimiter(source, open, literals) > offset)?.kind ?? null;
}

function literalTokenBounds(source, literal) {
  const delimiter = source[literal.contentStart - 1];
  if (delimiter !== '"' && delimiter !== "'") return null;
  let start = literal.contentStart - 1;
  let end = literal.end + 1;
  if (delimiter === '"') {
    const rawPrefix = source.slice(Math.max(0, start - 64), start).match(/(?:br|r)(#+)$/u);
    if (rawPrefix !== null) {
      start -= rawPrefix[0].length;
      end += rawPrefix[1].length;
    }
  }
  return { start, end };
}

function maskedNameCollection(source, open, close, literals) {
  const masked = source.slice(open + 1, close).split('');
  function mask(start, end, placeholder = null) {
    const boundedStart = Math.max(open + 1, start);
    const boundedEnd = Math.min(close, end);
    for (let offset = boundedStart; offset < boundedEnd; offset += 1) {
      masked[offset - open - 1] = ' ';
    }
    if (placeholder !== null && boundedStart < boundedEnd) {
      masked[boundedStart - open - 1] = placeholder;
    }
  }
  for (const comment of literals.comments) mask(comment.start, comment.end);
  for (const literal of literals.ranges) {
    const bounds = literalTokenBounds(source, literal);
    if (bounds !== null) mask(bounds.start, bounds.end, '§');
  }
  return masked.join('');
}

function skipCollectionTrivia(source, offset, end, commentsByStart) {
  let cursor = offset;
  while (cursor < end) {
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    const commentEnd = commentsByStart.get(cursor);
    if (commentEnd === undefined) break;
    cursor = commentEnd;
  }
  return cursor;
}

function directCollectionSegments(source, open, close, literals, pairs) {
  const excludedByStart = new Map();
  for (const range of [
    ...literals.comments,
    ...literals.ranges.map((literal) => literalTokenBounds(source, literal)).filter(Boolean),
    ...pairs.filter((pair) => open < pair.open && pair.close < close),
  ]) {
    excludedByStart.set(range.start ?? range.open, Math.max(
      excludedByStart.get(range.start ?? range.open) ?? 0,
      range.end ?? (range.close + 1),
    ));
  }
  const segments = [];
  let segmentStart = open + 1;
  let cursor = segmentStart;
  while (cursor < close) {
    const excludedEnd = excludedByStart.get(cursor);
    if (excludedEnd !== undefined) {
      cursor = excludedEnd;
    } else if (source[cursor] === ',') {
      segments.push({ start: segmentStart, end: cursor });
      segmentStart = cursor + 1;
      cursor += 1;
    } else {
      cursor += 1;
    }
  }
  segments.push({ start: segmentStart, end: close });
  return segments;
}

function stringKeyNameCollectionOffsets(source, open, close, literals, matches, pairs) {
  const commentsByStart = new Map(literals.comments.map(({ start, end }) => [start, end]));
  const literalsByTokenStart = new Map(literals.ranges.flatMap((literal) => {
    const bounds = literalTokenBounds(source, literal);
    return bounds === null ? [] : [[bounds.start, { ...bounds, literal }]];
  }));
  const matchesByOffset = new Map(matches.map((match) => [match.index, match]));
  const offsets = new Set();
  let properties = 0;
  for (const segment of directCollectionSegments(source, open, close, literals, pairs)) {
    const keyStart = skipCollectionTrivia(source, segment.start, segment.end, commentsByStart);
    if (keyStart === segment.end) continue;
    properties += 1;
    const key = literalsByTokenStart.get(keyStart);
    if (key === undefined) return null;
    const match = matchesByOffset.get(key.literal.contentStart);
    if (
      match === undefined
      || key.literal.end !== match.index + match[0].length
    ) return null;
    const colon = skipCollectionTrivia(source, key.end, segment.end, commentsByStart);
    if (source[colon] !== ':') return null;
    offsets.add(match.index);
  }
  return properties === 0 ? null : offsets;
}

function environmentNameTableOffsets(source, literals, matches) {
  const offsets = new Set();
  const pairs = lexicalDelimiterPairs(source, literals);
  for (const { open, close } of pairs) {
    if (source[open] !== '[' && source[open] !== '{') continue;
    const prefix = source.slice(Math.max(0, open - 2048), open);
    const javaScriptDeclaration = prefix.match(
      /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:Object\.freeze|new\s+Set)\s*\(\s*)?$/u,
    );
    const rustDeclaration = prefix.match(
      /\b(?:pub\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:[^=;]{0,512}=\s*&?\s*$/u,
    );
    const identifier = javaScriptDeclaration?.[1] ?? rustDeclaration?.[1];
    if (identifier === undefined) continue;
    const after = source.slice(close + 1, close + 4097);
    const environmentEntryLoop = after.match(
      /\bfor\s*\(\s*const\s*\[\s*([A-Za-z_$][\w$]*)[^\]]*\]\s+of\s+Object\.entries\s*\(\s*(?:process|Bun)\.env\s*\)/u,
    );
    const environmentMembershipConsumer = environmentEntryLoop !== null
      && new RegExp(
        String.raw`\b${escapeRegExp(identifier)}\s*\.(?:has|includes|contains)\s*\(\s*${escapeRegExp(environmentEntryLoop[1])}(?:\.toUpperCase\s*\(\s*\))?\s*\)`,
        'u',
      ).test(after.slice(environmentEntryLoop.index));
    if (!isEnvironmentIdentifier(identifier) && !environmentMembershipConsumer) continue;

    const masked = maskedNameCollection(source, open, close, literals);
    const stringArray = source[open] === '['
      && /^(?:\s*§\s*(?:,\s*§\s*)*,?\s*)?$/u.test(masked);
    const key = String.raw`(?:[A-Za-z_$][\w$]*|§)`;
    const property = String.raw`${key}\s*:\s*§`;
    const stringValueObject = source[open] === '{'
      && new RegExp(`^(?:\\s*${property}\\s*(?:,\\s*${property}\\s*)*,?\\s*)?$`, 'u').test(masked);
    const stringKeyOffsets = source[open] === '{'
      ? stringKeyNameCollectionOffsets(source, open, close, literals, matches, pairs)
      : null;
    if (!stringArray && !stringValueObject && stringKeyOffsets === null) continue;

    for (const match of matches) {
      if (!(open < match.index && match.index < close)) continue;
      const literal = enclosingStringLiteral(match.index, literals);
      if (
        literal === null
        || literal.contentStart !== match.index
        || literal.end !== match.index + match[0].length
      ) continue;
      const nested = pairs.some((pair) => (
        open < pair.open
        && pair.open < match.index
        && match.index < pair.close
        && pair.close < close
      ));
      if (
        !nested
        && (stringArray || stringValueObject || stringKeyOffsets.has(match.index))
      ) offsets.add(match.index);
    }
  }
  return offsets;
}

function lexicalDelimiterPairs(source, literals) {
  const excluded = [
    ...literals.comments,
    ...(literals.lexicalExcluded ?? []),
    ...literals.ranges.map(({ contentStart, end }) => ({ start: contentStart, end })),
  ].sort((left, right) => left.start - right.start);
  const stack = [];
  const pairs = [];
  const closing = { '(': ')', '[': ']', '{': '}' };
  let excludedIndex = 0;
  for (let index = 0; index < source.length; index += 1) {
    while (excludedIndex < excluded.length && excluded[excludedIndex].end <= index) {
      excludedIndex += 1;
    }
    const range = excluded[excludedIndex];
    if (range !== undefined && range.start <= index && index < range.end) {
      index = range.end - 1;
      continue;
    }
    const character = source[index];
    if (closing[character] !== undefined) {
      stack.push({ open: index, close: closing[character] });
    } else if (stack.at(-1)?.close === character) {
      const opener = stack.pop();
      pairs.push({ open: opener.open, close: index });
    }
  }
  return pairs;
}

function rustIndirectEnvironmentOffsets(source) {
  const offsets = new Set();
  const declarations = source.matchAll(
    /\b(?:pub\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:\s*&(?:'static\s+)?str\s*=\s*(?:r#*)?"(SNAPBACK_[A-Z0-9_]+)"/gu,
  );
  for (const declaration of declarations) {
    const identifier = declaration[1];
    const read = new RegExp(
      `(?:\\b(?:std::)?env::(?:var|var_os)|\\bvar_os)\\s*\\(\\s*${escapeRegExp(identifier)}\\b`,
      'u',
    );
    if (!read.test(source)) continue;
    const code = declaration[2];
    const offset = declaration.index + declaration[0].lastIndexOf(code);
    offsets.add(offset);
  }
  return offsets;
}

function javaScriptIndirectEnvironmentOffsets(source) {
  const offsets = new Set();
  const helpers = [...environmentHelperNames(source)];
  for (const declaration of source.matchAll(
    /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*["'](SNAPBACK_[A-Z0-9_]+)["']/gu,
  )) {
    const identifier = escapeRegExp(declaration[1]);
    const accessorUse = new RegExp(
      `(?:\\b(?:process|Bun)\\.env(?:\\?\\.)?\\[\\s*${identifier}\\s*\\]|\\bDeno\\.env\\.(?:get|has)\\s*\\(\\s*${identifier}\\b|\\b(?:this\\.)?(?:env|environment)(?:\\?\\.)?\\[\\s*${identifier}\\s*\\])`,
      'u',
    );
    const helperUse = helpers.length === 0 ? null : new RegExp(
      `\\b(?:${helpers.map(escapeRegExp).join('|')})\\s*\\(\\s*${identifier}\\b`,
      'u',
    );
    if (
      !isEnvironmentIdentifier(declaration[1])
      && !accessorUse.test(source)
      && !(helperUse?.test(source) ?? false)
    ) continue;
    const code = declaration[2];
    offsets.add(declaration.index + declaration[0].lastIndexOf(code));
  }
  return offsets;
}

function environmentHelperNames(source, literals) {
  const helpers = new Set();
  const blockDeclarations = [
    ...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{/gu),
    ...source.matchAll(/\bfn\s+([a-z_][a-z0-9_]*)\s*\(\s*([a-z_][a-z0-9_]*)[^)]*\)\s*[^{}]*\{/gu),
    // JavaScript class/object concise methods, including async methods. The
    // declaration must start at a statement boundary so calls followed by a
    // callback block are not mistaken for helper definitions.
    ...source.matchAll(/(?:^|[;{}]\s*|\n\s*)(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{/gmu),
    // Class fields and object properties whose value is a block-bodied arrow.
    ...source.matchAll(/(?:^|[;{},]\s*|\n\s*)(?:static\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*=>\s*\{/gmu),
    ...source.matchAll(/(?:^|[;{},]\s*|\n\s*)(?:static\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*\{/gmu),
  ];
  for (const declaration of blockDeclarations) {
    const open = declaration.index + declaration[0].lastIndexOf('{');
    const body = source.slice(open, matchingDelimiter(source, open, literals) + 1);
    const parameter = escapeRegExp(declaration[2]);
    const dynamicRead = new RegExp(
      `(?:process\\.env(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|(?:this\\.)?(?:env|environment)(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|(?:std::)?env::(?:var|var_os)\\(\\s*${parameter}\\s*\\))`,
      'u',
    );
    if (dynamicRead.test(body) && !isLanguageKeyword(declaration[1])) {
      helpers.add(declaration[1]);
    }
  }
  for (const declaration of source.matchAll(
    /(?:^|[;{},]\s*|\n\s*)(?:static\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*=>\s*([^;\n]+)/gmu,
  )) {
    const parameter = escapeRegExp(declaration[2]);
    const dynamicRead = new RegExp(
      `(?:process\\.env(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|(?:this\\.)?(?:env|environment)(?:\\?\\.)?\\[\\s*${parameter}\\s*\\])`,
      'u',
    );
    if (dynamicRead.test(declaration[3]) && !isLanguageKeyword(declaration[1])) {
      helpers.add(declaration[1]);
    }
  }
  for (const declaration of source.matchAll(
    /(?:^|[;{},]\s*|\n\s*)(?:static\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*([^;\n]+)/gmu,
  )) {
    const parameter = escapeRegExp(declaration[2]);
    const dynamicRead = new RegExp(
      `(?:process\\.env(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|(?:this\\.)?(?:env|environment)(?:\\?\\.)?\\[\\s*${parameter}\\s*\\])`,
      'u',
    );
    if (dynamicRead.test(declaration[3]) && !isLanguageKeyword(declaration[1])) {
      helpers.add(declaration[1]);
    }
  }
  return helpers;
}

export function indirectEnvironmentReadContracts(source) {
  const contracts = [];
  const literals = javaScriptLiteralBounds(source);
  for (const declaration of source.matchAll(
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*\{([\s\S]{0,4096}?)\}\s*\)\s*\{/gu,
  )) {
    const helper = declaration[1];
    const parameters = declaration[2].split(',').flatMap((entry) => {
      const normalized = entry.trim().replace(/\s*=.*$/su, '').trim();
      if (normalized.length === 0 || normalized.startsWith('...')) return [];
      const [property, binding = property] = normalized.split(':').map((value) => value.trim());
      return /^[A-Za-z_$][\w$]*$/u.test(property)
          && /^[A-Za-z_$][\w$]*$/u.test(binding)
        ? [{ property, binding }]
        : [];
    });
    const environmentBindings = parameters
      .filter(({ binding }) => isEnvironmentIdentifier(binding))
      .map(({ binding }) => binding);
    if (environmentBindings.length === 0) continue;
    const open = declaration.index + declaration[0].lastIndexOf('{');
    const body = source.slice(open, matchingDelimiter(source, open, literals) + 1);
    for (const { property, binding } of parameters) {
      if (environmentBindings.includes(binding)) continue;
      const parameter = escapeRegExp(binding);
      const readsEnvironment = environmentBindings.some((environmentBinding) => {
        const environment = escapeRegExp(environmentBinding);
        return new RegExp(
          `(?:\\b${environment}(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|\\bObject\\.hasOwn\\s*\\(\\s*${environment}\\s*,\\s*${parameter}\\b)`,
          'u',
        ).test(body);
      });
      if (readsEnvironment) contracts.push({ helper, property });
    }
  }
  return contracts.sort((left, right) => (
    left.helper.localeCompare(right.helper) || left.property.localeCompare(right.property)
  ));
}

function helperObjectCallContains(source, helper, offset, literals) {
  const callPattern = new RegExp(`\\b${escapeRegExp(helper)}\\s*\\(\\s*\\{`, 'gu');
  for (const call of source.matchAll(callPattern)) {
    const open = call.index + call[0].lastIndexOf('{');
    if (open >= offset) break;
    if (matchingDelimiter(source, open, literals) > offset) return true;
  }
  return false;
}

function indirectEnvironmentHelperOffsets(source, matches, readContracts, literals) {
  const helpers = [...environmentHelperNames(source, literals)];
  const call = helpers.length === 0 ? null : new RegExp(
    `\\b(?:${helpers.map(escapeRegExp).join('|')})\\s*\\(\\s*["']$`,
    'u',
  );
  const contracts = readContracts ?? indirectEnvironmentReadContracts(source);
  return new Set(matches.filter((match) => {
    if (call?.test(source.slice(Math.max(0, match.index - 256), match.index))) return true;
    return contracts.some(({ helper, property }) => (
      new RegExp(`\\b${escapeRegExp(property)}\\s*:\\s*["']$`, 'u').test(
        source.slice(Math.max(0, match.index - 256), match.index),
      )
      && helperObjectCallContains(source, helper, match.index, literals)
    ));
  }).map((match) => match.index));
}

// This purpose-built tokenizer keeps the generator dependency-free while
// tracking the lexical distinctions the registry needs: comments, strings,
// expression-position regex literals versus division, and nested template
// expressions. It does not attempt to build a JavaScript AST.
function javaScriptLiteralBounds(source) {
  const byContentStart = new Map();
  const comments = [];
  const lexicalExcluded = [];
  const ranges = [];
  const regexPrefixKeywords = new Set([
    'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new',
    'return', 'throw', 'typeof', 'void', 'yield',
  ]);
  const controlConditionKeywords = new Set([
    'catch', 'for', 'if', 'switch', 'while', 'with',
  ]);

  function addLiteral(contentStart, end) {
    const literal = { contentStart, end };
    byContentStart.set(contentStart, literal);
    ranges.push(literal);
  }

  function scanQuoted(open, delimiter) {
    const contentStart = open + 1;
    let cursor = contentStart;
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (source[cursor] === delimiter) {
        addLiteral(contentStart, cursor);
        return cursor + 1;
      }
      if (source[cursor] === '\n' || source[cursor] === '\r') return open + 1;
      cursor += 1;
    }
    return open + 1;
  }

  function scanRegex(open) {
    let cursor = open + 1;
    let characterClass = false;
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (source[cursor] === '\n' || source[cursor] === '\r') return open + 1;
      if (source[cursor] === '[') characterClass = true;
      else if (source[cursor] === ']') characterClass = false;
      else if (source[cursor] === '/' && !characterClass) {
        cursor += 1;
        while (/[$\w]/u.test(source[cursor] ?? '')) cursor += 1;
        return cursor;
      }
      cursor += 1;
    }
    return open + 1;
  }

  function scanTemplate(open) {
    let contentStart = open + 1;
    let cursor = contentStart;
    while (cursor < source.length) {
      if (source[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (source[cursor] === '`') {
        addLiteral(contentStart, cursor);
        return cursor + 1;
      }
      if (source.startsWith('${', cursor)) {
        addLiteral(contentStart, cursor);
        cursor = scanCode(cursor + 2, true);
        contentStart = cursor;
        continue;
      }
      cursor += 1;
    }
    return open + 1;
  }

  function scanCode(start, stopAtTemplateBrace) {
    let index = start;
    let braceDepth = 0;
    let expectExpression = true;
    let previousWord = '';
    const conditionParens = [];
    while (index < source.length) {
      const character = source[index];
      if (/\s/u.test(character)) {
        index += 1;
        continue;
      }
      if (source.startsWith('//', index)) {
        const newline = source.indexOf('\n', index + 2);
        const end = newline === -1 ? source.length : newline;
        comments.push({ start: index, end });
        index = newline === -1 ? source.length : newline + 1;
        continue;
      }
      if (source.startsWith('/*', index)) {
        const close = source.indexOf('*/', index + 2);
        const end = close === -1 ? source.length : close + 2;
        comments.push({ start: index, end });
        index = end;
        continue;
      }
      if (character === '"' || character === "'") {
        const next = scanQuoted(index, character);
        if (next === index + 1) {
          index += 1;
        } else {
          index = next;
          expectExpression = false;
          previousWord = '';
        }
        continue;
      }
      if (character === '`') {
        const next = scanTemplate(index);
        index = next === index + 1 ? index + 1 : next;
        expectExpression = false;
        previousWord = '';
        continue;
      }
      if (character === '/') {
        if (expectExpression) {
          const next = scanRegex(index);
          if (next !== index + 1) {
            lexicalExcluded.push({ start: index, end: next });
            index = next;
            expectExpression = false;
            previousWord = '';
            continue;
          }
        }
        index += source[index + 1] === '=' ? 2 : 1;
        expectExpression = true;
        previousWord = '';
        continue;
      }
      if (/[A-Za-z_$]/u.test(character)) {
        const word = source.slice(index).match(/^[A-Za-z_$][\w$]*/u)[0];
        index += word.length;
        expectExpression = regexPrefixKeywords.has(word);
        previousWord = word;
        continue;
      }
      if (/\d/u.test(character)) {
        const number = source.slice(index).match(/^(?:0[xob][\da-f_]+|\d[\d._e+-]*)/iu)[0];
        index += number.length;
        expectExpression = false;
        previousWord = '';
        continue;
      }
      if (character === '(') {
        conditionParens.push(controlConditionKeywords.has(previousWord));
        index += 1;
        expectExpression = true;
        previousWord = '';
        continue;
      }
      if (character === ')') {
        expectExpression = conditionParens.pop() === true;
        index += 1;
        previousWord = '';
        continue;
      }
      if (character === '{') {
        braceDepth += 1;
        index += 1;
        expectExpression = true;
        previousWord = '';
        continue;
      }
      if (character === '}') {
        if (stopAtTemplateBrace && braceDepth === 0) return index + 1;
        braceDepth = Math.max(0, braceDepth - 1);
        index += 1;
        expectExpression = false;
        previousWord = '';
        continue;
      }
      if (character === '[') {
        index += 1;
        expectExpression = true;
        previousWord = '';
        continue;
      }
      if (character === ']') {
        index += 1;
        expectExpression = false;
        previousWord = '';
        continue;
      }
      if (character === '.') {
        index += source.startsWith('...', index) ? 3 : 1;
        expectExpression = false;
        previousWord = '';
        continue;
      }
      if (character === ';' || character === ',' || character === ':' || character === '?') {
        index += source.startsWith('?.', index) ? 2 : 1;
        expectExpression = true;
        previousWord = '';
        continue;
      }
      if ('=+-*%&|^!~<>'.includes(character)) {
        const operator = source.slice(index).match(/^(?:===|!==|>>>|\*\*|&&|\|\||\?\?|=>|==|!=|<=|>=|<<|>>|\+\+|--|\+=|-=|\*=|%=|&=|\|=|\^=|[=+\-*%&|^!~<>])/u)[0];
        index += operator.length;
        expectExpression = operator !== '++' && operator !== '--';
        previousWord = '';
        continue;
      }
      index += 1;
      previousWord = '';
    }
    return index;
  }

  scanCode(0, false);
  ranges.sort((left, right) => left.contentStart - right.contentStart);
  comments.sort((left, right) => left.start - right.start);
  lexicalExcluded.sort((left, right) => left.start - right.start);
  return { byContentStart, comments, lexicalExcluded, ranges };
}

function shellLiteralBounds(source) {
  const byContentStart = new Map();
  const comments = [];
  const ranges = [];
  let index = 0;
  while (index < source.length) {
    if (
      source[index] === '#'
      && (index === 0 || /[\s;|&()]/u.test(source[index - 1]))
    ) {
      const newline = source.indexOf('\n', index + 1);
      const end = newline === -1 ? source.length : newline;
      comments.push({ start: index, end });
      index = end;
      continue;
    }
    const delimiter = source[index];
    if (delimiter !== '"' && delimiter !== "'") {
      index += 1;
      continue;
    }
    const contentStart = index + 1;
    let cursor = contentStart;
    while (cursor < source.length) {
      if (delimiter === '"' && source[cursor] === '\\') {
        cursor += 2;
        continue;
      }
      if (source[cursor] === delimiter) break;
      cursor += 1;
    }
    if (cursor === source.length) {
      index += 1;
      continue;
    }
    const literal = { contentStart, end: cursor };
    byContentStart.set(contentStart, literal);
    ranges.push(literal);
    index = cursor + 1;
  }
  return { byContentStart, comments, ranges };
}

function stringLiteralBounds(source, {
  ordinaryMultiline = false,
  javascript = false,
  shell = false,
} = {}) {
  if (javascript) return javaScriptLiteralBounds(source);
  if (shell) return shellLiteralBounds(source);
  const byContentStart = new Map();
  const comments = [];
  const ranges = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      const end = newline === -1 ? source.length : newline;
      comments.push({ start: index, end });
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      let cursor = index + 2;
      let depth = 1;
      while (cursor < source.length && depth > 0) {
        if (ordinaryMultiline && source.startsWith('/*', cursor)) {
          depth += 1;
          cursor += 2;
        } else if (source.startsWith('*/', cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      const end = cursor;
      comments.push({ start: index, end });
      index = end;
      continue;
    }

    const delimiter = source.startsWith('"""', index)
      ? '"""'
      : ['"', "'", '`'].includes(source[index])
        ? source[index]
        : null;
    if (delimiter === null) {
      index += 1;
      continue;
    }

    const rawPrefix = delimiter === '"'
      ? source.slice(Math.max(0, index - 32), index).match(/(?:^|[^A-Za-z0-9_])(?:br|r)(#{0,255})$/u)
      : null;
    const closingDelimiter = rawPrefix === null ? delimiter : `"${rawPrefix[1]}`;
    const raw = rawPrefix !== null;
    const contentStart = index + delimiter.length;
    let cursor = contentStart;
    let terminated = false;
    while (cursor < source.length) {
      if (source.startsWith(closingDelimiter, cursor)) {
        terminated = true;
        break;
      }
      // JavaScript strings, Rust character literals, and Rust lifetimes cannot
      // carry an unescaped newline between single quotes. Treating a lifetime
      // as a string opener would hide every later literal until the next
      // apostrophe in the file.
      if (
        source[cursor] === '\n'
        && (delimiter === "'" || (delimiter === '"' && !ordinaryMultiline))
      ) break;
      if (!raw && delimiter.length === 1 && source[cursor] === '\\') {
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    if (!terminated) {
      index += delimiter.length;
      continue;
    }
    const literal = { contentStart, end: cursor };
    byContentStart.set(contentStart, literal);
    ranges.push(literal);
    index = cursor + closingDelimiter.length;
  }
  return { byContentStart, comments, ranges };
}

function codeOffset(offset, literals) {
  return !isCommentReference(offset, literals.comments)
    && enclosingStringLiteral(offset, literals) === null;
}

function rustDeclarationBrace(source, start, kind, literals) {
  const tail = source.slice(start);
  const declaration = kind === 'module'
    ? tail.match(/^(?:(?:\s*#\[[^\]]+\])|(?:\s*\/\/[^\r\n]*(?:\r?\n|$)))*\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*/u)
    : tail.match(/^(?:(?:\s*#\[[^\]]+\])|(?:\s*\/\/[^\r\n]*(?:\r?\n|$)))*\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern(?:\s+"[^"]+")?)\s+)*fn\s+[A-Za-z_][A-Za-z0-9_]*\b/u);
  if (declaration === null) return null;
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = start + declaration[0].length; index < source.length; index += 1) {
    if (!codeOffset(index, literals)) continue;
    if (source[index] === '(') parenDepth += 1;
    else if (source[index] === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (source[index] === '[') bracketDepth += 1;
    else if (source[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (source[index] === '{' && parenDepth === 0 && bracketDepth === 0) return index;
    else if (source[index] === ';' && parenDepth === 0 && bracketDepth === 0) return null;
  }
  return null;
}

function rustAttributedRegionEnd(source, start, literals, delimiterCloses) {
  for (const kind of ['module', 'function']) {
    const open = rustDeclarationBrace(source, start, kind, literals);
    const close = open === null ? undefined : delimiterCloses.get(open);
    if (close !== undefined) return close + 1;
  }

  let parenDepth = 0;
  let bracketDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (!codeOffset(index, literals)) continue;
    if (source[index] === '(') parenDepth += 1;
    else if (source[index] === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (source[index] === '[') bracketDepth += 1;
    else if (source[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (source[index] === '{' && parenDepth === 0 && bracketDepth === 0) {
      const close = delimiterCloses.get(index);
      return close === undefined ? null : close + 1;
    } else if (
      (source[index] === ';' || source[index] === ',' || source[index] === '}')
      && parenDepth === 0
      && bracketDepth === 0
    ) {
      return index + 1;
    }
  }
  return null;
}

// Preserve byte offsets and line numbers while removing Rust regions that are
// compiled only by the test harness from the production registry population.
export function rustProductionSource(source) {
  if (!/#\s*\[\s*(?:cfg\s*\(\s*test\s*\)|test)\s*\]/u.test(source)) return source;
  const literals = stringLiteralBounds(source, { ordinaryMultiline: true });
  const delimiterCloses = new Map(
    lexicalDelimiterPairs(source, literals).map(({ open, close }) => [open, close]),
  );
  const ranges = [];
  const attributes = /^\s*#\s*\[\s*(cfg\s*\(\s*test\s*\)|test)\s*\]/gmu;
  for (const attribute of source.matchAll(attributes)) {
    const marker = attribute.index + attribute[0].indexOf('#');
    if (!codeOffset(marker, literals)) continue;
    if (ranges.some((range) => range.start <= marker && marker < range.end)) continue;
    const end = rustAttributedRegionEnd(
      source,
      attribute.index + attribute[0].length,
      literals,
      delimiterCloses,
    );
    if (end === null) continue;
    ranges.push({ start: attribute.index, end });
  }
  if (ranges.length === 0) return source;
  ranges.sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  let cursor = 0;
  let result = '';
  for (const range of merged) {
    result += source.slice(cursor, range.start);
    result += source.slice(range.start, range.end).replace(/[^\r\n]/gu, 'x');
    cursor = range.end;
  }
  return result + source.slice(cursor);
}

function enclosingStringLiteral(offset, literals) {
  let low = 0;
  let high = literals.ranges.length - 1;
  let candidate = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const literal = literals.ranges[middle];
    if (literal.contentStart <= offset) {
      candidate = literal;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate !== null && offset < candidate.end ? candidate : null;
}

function diagnosticLiteralShape(match, literals) {
  const source = match.input;
  const end = match.index + match[0].length;
  const literal = enclosingStringLiteral(match.index, literals);
  if (literal === null) return null;
  if (literal.contentStart === match.index) {
    if (literal.end === end) return 'whole';
    if (source[end] === ':') return 'prefix';
    return 'reference';
  }

  const leadingText = source.slice(literal.contentStart, match.index);
  if (source[end] === ':' && /^(?:WARNING|ERROR|INFO)\s+$/u.test(leadingText)) {
    return 'prefix';
  }

  // Preserve the immediately surrounding nested quote shape for generated
  // source/SQL classifiers without admitting arbitrary quoted prose. Escaped
  // closing quotes occur inside ordinary Rust/JavaScript host strings.
  const quotedBefore = /["'`]$/u.test(leadingText);
  const quotedAfter = /^(?:\\)?["'`]/u.test(source.slice(end, end + 2));
  if (quotedBefore && quotedAfter) return 'nested-whole';
  if (quotedBefore && source[end] === ':') return 'nested-prefix';
  return 'reference';
}

function isExplicitDiagnosticCodePosition(source, offset) {
  const before = source.slice(Math.max(0, offset - 512), offset);
  return (
    /\bthrow\b[^;\n]*$/u.test(before)
    || /\bnew\s+(?:Snapback)?Error\s*\(\s*["'`]$/u.test(before)
    || /\b(?:code|diagnosticCode|diagnostic_code|errorCode|error_code)\s*:\s*["'`]$/u.test(before)
    || /\.code\s*=\s*["'`]$/u.test(before)
    || /\b(?:kitError|requestDiagnostic)\s*\(\s*\d{3}\s*,\s*["'`]$/u.test(before)
    || /\b(?:bindingFailure|diagnosticError|codedError|verifyError|codegenError|conformanceDiagnostic|graph_serving_error|__snapbackFail|__snapbackFamiliarFail|snapbackError)\s*\(\s*["'`]$/u.test(before)
    || /\b(?:SnapbackError|Diagnostic)::(?:error|warning|info|new)\s*\(\s*["'`]$/u.test(before)
  );
}

function isDiagnosticPrintPosition(source, offset) {
  const before = source.slice(Math.max(0, offset - 512), offset);
  return (
    /\b(?:e?println)!\s*\(\s*(?:r#*)?"$/su.test(before)
    || /\b(?:tracing|log)::[a-z_][a-z0-9_]*!\s*\(\s*(?:r#*)?"$/su.test(before)
    || /\bconsole\.(?:error|warn)\s*\(\s*["'`]$/su.test(before)
  );
}

function isLeadingDiagnosticCodePosition(source, match, literals) {
  const literal = literals.byContentStart.get(match.index);
  if (literal === undefined) return false;
  const end = match.index + match[0].length;
  const printPosition = isDiagnosticPrintPosition(source, match.index);
  if (literal.end !== end && source[end] !== ':' && !printPosition) return false;
  return isExplicitDiagnosticCodePosition(source, match.index)
    || printPosition;
}

function isGeneratedSourceDiagnosticPosition(source, match, literals) {
  const literal = enclosingStringLiteral(match.index, literals);
  if (literal === null || literal.contentStart === match.index) return false;
  const before = source.slice(Math.max(literal.contentStart, match.index - 512), match.index);

  // A nested token is an emission only when the enclosing host-language string
  // is demonstrably executable/generated source and local nested syntax binds
  // it to an Error/throw, diagnostic-like call, or code property. A quoted code
  // in prose, a regex, or stored protocol text remains a reference.
  return (
    /\b(?:throw\s+(?:new\s+)?|new\s+)Error\s*\(\s*\\?["'`]$/u.test(before)
    || /(?:\\?["'])?\b(?:code|diagnosticCode|diagnostic_code|errorCode|error_code)(?:\\?["'])?\s*[:=]\s*\\?["'`]$/u.test(before)
    || /\b[A-Za-z_$][\w$]*(?:Fail|fail|Error|error|Diagnostic|diagnostic|Refuse|refuse)\s*\(\s*\\?["'`]$/u.test(before)
  );
}

function isStoredDiagnosticSqlPosition(source, match, literals) {
  const literal = enclosingStringLiteral(match.index, literals);
  if (literal === null) return false;
  const before = source.slice(literal.contentStart, match.index);
  const statement = source.slice(literal.contentStart, literal.end);
  if (!/\b(?:INSERT|REPLACE|UPDATE)\b/iu.test(statement)) return false;

  // SQL emits only when it writes the token into an explicitly named
  // diagnostic/error-code column. WHERE predicates and read-only code tables
  // are references. INSERT/REPLACE prove the column list plus VALUES; UPDATE
  // proves a SET assignment.
  const codeColumn = '(?:diagnostic_code|error_code|last_error_code)';
  const updateAssignment = new RegExp(
    `\\bSET\\b[\\s\\S]*\\b${codeColumn}\\s*=\\s*["']$`,
    'iu',
  );
  if (updateAssignment.test(before)) return true;
  const insertValue = new RegExp(
    `\\b(?:INSERT|REPLACE)\\s+INTO\\b[\\s\\S]*\\([^)]*\\b${codeColumn}\\b[^)]*\\)\\s*VALUES\\s*\\([^)]*["']$`,
    'iu',
  );
  return insertValue.test(before);
}

function isEscapedPoisonDiagnosticPosition(source, match, literals) {
  const literal = enclosingStringLiteral(match.index, literals);
  if (literal === null) return false;
  return /\\["'`]$/u.test(source.slice(literal.contentStart, match.index))
    && source[match.index + match[0].length] === ':';
}

function isHtmlDiagnosticPosition(source, match) {
  return source.slice(Math.max(0, match.index - 16), match.index).endsWith('<code>')
    && source.slice(
      match.index + match[0].length,
      match.index + match[0].length + 16,
    ).startsWith('</code>');
}

function isUnrecognizedDiagnosticReference(source, match) {
  return /^["']?[\s\S]{0,384}["']unrecognized["']\s*:\s*true/u.test(source.slice(
    match.index + match[0].length,
    match.index + match[0].length + 512,
  ));
}

function shellEnvironmentSiteKind(source, offset, code, literals) {
  const literal = enclosingStringLiteral(offset, literals);
  if (literal !== null && source[literal.contentStart - 1] === "'") return null;
  const before = source.slice(Math.max(0, offset - 2), offset);
  const after = source.slice(offset + code.length);
  if (/^\+?=/u.test(after) && literal === null) {
    const line = lineBounds(source, offset);
    const maskedPrefix = source.slice(line.start, offset).split('');
    for (const range of literals.ranges) {
      const start = Math.max(line.start, range.contentStart - 1);
      const end = Math.min(offset, range.end + 1);
      for (let index = start; index < end; index += 1) {
        maskedPrefix[index - line.start] = 'x';
      }
    }
    const commandPrefix = maskedPrefix.join('').replace(
      /^.*(?:&&|\|\||[;|])/u,
      '',
    );
    if (
      /^\s*(?:\(\s*)?(?:(?:export|env)(?:\s+-\S+)*\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*$/u
        .test(commandPrefix)
    ) return 'write';
  }
  if (before.endsWith('${') && /^(?:\}|[:#%/?+=-])/u.test(after)) return 'read';
  if (before.endsWith('$') && !/[\\$]\$$/u.test(before)) return 'read';
  return null;
}

function environmentAnalysis(source, options) {
  const matches = [...source.matchAll(DIAGNOSTIC_CODE_PATTERN)];
  const literals = stringLiteralBounds(source, options);
  const bracePairs = lexicalDelimiterPairs(source, literals)
    .filter(({ open }) => source[open] === '{');
  const nameTableOffsets = environmentNameTableOffsets(source, literals, matches);
  const siteKinds = new Map();
  for (const offset of rustIndirectEnvironmentOffsets(source)) {
    siteKinds.set(offset, 'indirect-read');
  }
  for (const offset of javaScriptIndirectEnvironmentOffsets(source)) {
    siteKinds.set(offset, 'declaration');
  }
  for (const offset of indirectEnvironmentHelperOffsets(
    source,
    matches,
    options.indirectEnvironmentReadContracts,
    literals,
  )) {
    siteKinds.set(offset, 'read');
  }
  for (const match of matches) {
    if (hasEnvironmentMarker(source, match.index, match[0])) {
      siteKinds.set(match.index, 'write');
      continue;
    }
    // Comments are references first; `process.env.SNAPBACK_X` in explanatory
    // prose must not become an environment read site.
    if (isCommentReference(match.index, literals.comments)) {
      siteKinds.delete(match.index);
      continue;
    }
    const shellKind = options.shell
      ? shellEnvironmentSiteKind(source, match.index, match[0], literals)
      : null;
    const directKind = directEnvironmentSiteKind(source, match.index, match[0]);
    const objectKind = javaScriptEnvironmentObjectKind(source, match.index, match[0], literals);
    if (shellKind !== null) {
      siteKinds.set(match.index, shellKind);
    } else if (directKind !== null) {
      siteKinds.set(match.index, directKind);
    } else if (objectKind !== null) {
      siteKinds.set(match.index, objectKind);
    } else if (nameTableOffsets.has(match.index)) {
      siteKinds.set(match.index, 'table-entry');
    }
  }
  const names = new Set(matches
    .filter((match) => siteKinds.has(match.index))
    .map((match) => match[0]));
  const declarations = new Map(matches.flatMap((match) => {
    const declaration = wholeStringCodeDeclaration(source, match, literals, bracePairs);
    return declaration === null ? [] : [[match.index, declaration]];
  }));
  return {
    declarations,
    literals,
    matches,
    names,
    siteKinds,
    receivedOffsets: new Set(),
  };
}

export function environmentVariableSites(source, {
  environmentNames,
  indirectEnvironmentReadContracts: readContracts,
  javascript,
  ordinaryMultiline,
  shell,
  excludeRustTestRegions = false,
  receivedProtocolVocabulary = false,
} = {}) {
  const classifiedSource = excludeRustTestRegions ? rustProductionSource(source) : source;
  const analysis = environmentAnalysis(classifiedSource, {
    indirectEnvironmentReadContracts: readContracts,
    javascript,
    ordinaryMultiline,
    shell,
  });
  const classifiedNames = environmentNames ?? analysis.names;
  analysis.receivedOffsets = receivedProtocolVocabulary
    ? receivedProtocolOffsets(classifiedSource, analysis.matches, analysis.literals)
    : new Set();
  return analysis.matches.flatMap((match) => {
    const kind = analysis.siteKinds.get(match.index);
    if (kind !== undefined) {
      return emissionWinsEnvironmentSite(source, match, analysis) ? [] : [{ match, kind }];
    }
    if (
      classifiedNames.has(match[0])
      && diagnosticSiteKind(classifiedSource, match, analysis, classifiedNames, { shell }) === null
      && analysis.literals.byContentStart.has(match.index)
      && !isCommentReference(match.index, analysis.literals.comments)
      && !isRustMatchArmPattern(classifiedSource, match.index, match[0])
      && !isCodeReferenceCatalogue(classifiedSource, match.index)
    ) {
      return [{ match, kind: 'mention' }];
    }
    return [];
  });
}

function isCommentReference(offset, comments) {
  let low = 0;
  let high = comments.length - 1;
  let candidate = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const comment = comments[middle];
    if (comment.start <= offset) {
      candidate = comment;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate !== null && offset < candidate.end;
}

function followingStatementOffset(source, offset) {
  let cursor = offset;
  while (cursor < source.length) {
    while (/\s/u.test(source[cursor] ?? '')) cursor += 1;
    if (source.startsWith('//', cursor)) {
      const newline = source.indexOf('\n', cursor + 2);
      cursor = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      const close = source.indexOf('*/', cursor + 2);
      cursor = close === -1 ? source.length : close + 2;
      continue;
    }
    break;
  }
  return cursor < source.length ? cursor : null;
}

function syntheticMatch(code, index, source) {
  const match = [code];
  match.index = index;
  match.input = source;
  return match;
}

function syntheticEmissionSites(source, comments) {
  const sites = [];
  const markerPattern = new RegExp(
    `${escapeRegExp(EMISSION_MARKER)}\\s+(SNAPBACK_[A-Z0-9_]*[A-Z0-9])(?![A-Z0-9_])`,
    'gu',
  );
  for (const marker of source.matchAll(markerPattern)) {
    if (!isCommentReference(marker.index, comments)) continue;
    const code = marker[1];
    const markerLine = lineBounds(source, marker.index);
    const beforeMarker = { start: markerLine.start, end: marker.index };
    // A same-line marker annotates the concrete literal before its comment.
    if (lineContainsCode(source, beforeMarker, code)) continue;
    const target = followingStatementOffset(source, markerLine.end);
    if (target === null) continue;
    const targetLine = lineBounds(source, target);
    // A concrete spelling on the target line remains the source coordinate;
    // only genuinely dynamic spellings need a synthetic match.
    if (lineContainsCode(source, targetLine, code)) continue;
    sites.push({
      match: syntheticMatch(code, target, source),
      kind: 'emission',
      synthetic: true,
    });
  }
  return sites;
}

function wholeStringCodeDeclaration(source, match, literals, bracePairs) {
  if (diagnosticLiteralShape(match, literals) !== 'whole') return null;
  const beforeStart = Math.max(0, match.index - 2048);
  const before = source.slice(beforeStart, match.index);
  const patterns = [
    /\b(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:[^=;{}]{0,1024}=\s*(?:r#*)?["']$/su,
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]$/su,
    /\b(?:(?:public|private|internal|fileprivate|open)\s+)?(?:static\s+)?(?:let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;{}]{0,1024})?=\s*"$/su,
    /\b(?:const\s+)?val\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;{}]{0,1024})?=\s*"$/su,
  ];
  for (const pattern of patterns) {
    const declaration = before.match(pattern);
    if (declaration === null) continue;
    const identifier = declaration[1];
    const enclosingBrace = /^[A-Z][A-Z0-9_]*$/u.test(identifier)
      ? undefined
      : bracePairs.filter(({ open, close }) => open < match.index && match.index < close)
        .sort((left, right) => right.open - left.open)[0];
    return {
      code: match[0],
      identifier,
      identifierOffset: beforeStart + declaration.index + declaration[0].indexOf(identifier),
      scopeEnd: enclosingBrace?.close ?? source.length,
      scopeStart: enclosingBrace === undefined ? 0 : enclosingBrace.open + 1,
    };
  }
  return null;
}

function identifierFlowEmissionSites(source, analysis) {
  const sites = [];
  const seen = new Set();
  for (const declaration of analysis.declarations.values()) {
    const identifier = escapeRegExp(declaration.identifier);
    const uses = new RegExp(
      `(?<![A-Za-z0-9_])(?:(?:[A-Za-z_][A-Za-z0-9_]*::)*)${identifier}(?![A-Za-z0-9_])`,
      'gu',
    );
    const scopedSource = source.slice(declaration.scopeStart, declaration.scopeEnd);
    for (const use of scopedSource.matchAll(uses)) {
      const useOffset = declaration.scopeStart + use.index;
      const identifierOffset = useOffset + use[0].lastIndexOf(declaration.identifier);
      if (identifierOffset === declaration.identifierOffset) continue;
      if (!codeOffset(identifierOffset, analysis.literals)) continue;
      const before = source.slice(Math.max(declaration.scopeStart, useOffset - 512), useOffset);
      const after = source.slice(useOffset + use[0].length, useOffset + use[0].length + 32);
      const explicitDiagnosticPosition = isExplicitDiagnosticIdentifierPosition(
        source,
        useOffset,
        analysis.literals,
      );
      const diagnosticProperty = /\b(?:code|[A-Za-z0-9_]*(?:diagnosticCode|errorCode|refusalCode|capabilityCode|diagnostic_code|error_code|refusal_code|capability_code))\s*(?::|=(?!=|>))\s*(?:Some\s*\(\s*)?$/su.test(before);
      const diagnosticShorthand = /(?:^|[{,])\s*$/su.test(before)
        && /^\s*[,}]/u.test(after)
        && !before.endsWith('${')
        && /^(?:code|.*Code|.*_CODE)$/u.test(declaration.identifier);
      if (!explicitDiagnosticPosition && !diagnosticProperty && !diagnosticShorthand) {
        continue;
      }
      const siteKey = `${declaration.code}\0${useOffset}`;
      if (seen.has(siteKey)) continue;
      seen.add(siteKey);
      sites.push({
        match: syntheticMatch(declaration.code, useOffset, source),
        kind: 'emission',
      });
    }
  }
  return sites;
}

function enclosingStartEndRange(offset, ranges) {
  let low = 0;
  let high = ranges.length - 1;
  let candidate = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (range.start <= offset) {
      candidate = range;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate !== null && offset < candidate.end ? candidate : null;
}

function throwExpressionContainsOffset(source, throwOffset, offset, literals) {
  let index = throwOffset + 'throw'.length;
  let canEndExpression = false;
  const delimiters = [];
  const prefixWords = new Set([
    'async', 'await', 'delete', 'in', 'instanceof', 'new', 'typeof', 'void', 'yield',
  ]);

  while (index < offset) {
    const comment = enclosingStartEndRange(index, literals.comments);
    if (comment !== null) {
      const newline = source.indexOf('\n', index);
      if (
        newline !== -1
        && newline < comment.end
        && delimiters.length === 0
        && canEndExpression
      ) return false;
      index = comment.end;
      continue;
    }
    const regex = enclosingStartEndRange(index, literals.lexicalExcluded ?? []);
    if (regex !== null) {
      index = regex.end;
      canEndExpression = true;
      continue;
    }
    const openingLiteral = literals.byContentStart.get(index + 1);
    if (
      openingLiteral !== undefined
      && (source[index] === '"' || source[index] === "'" || source[index] === '`')
    ) {
      index = openingLiteral.end + 1;
      canEndExpression = true;
      continue;
    }
    const literal = enclosingStringLiteral(index, literals);
    if (literal !== null) {
      index = literal.end;
      canEndExpression = true;
      continue;
    }

    const character = source[index];
    if (character === '\n' || character === '\r') {
      if (delimiters.length === 0 && canEndExpression) return false;
      index += character === '\r' && source[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const word = source.slice(index).match(/^[A-Za-z_$][\w$]*/u)[0];
      index += word.length;
      canEndExpression = !prefixWords.has(word);
      continue;
    }
    if (/\d/u.test(character)) {
      const number = source.slice(index).match(/^(?:0[xob][\da-f_]+|\d[\d._e+-]*)/iu)[0];
      index += number.length;
      canEndExpression = true;
      continue;
    }
    if (character === '(' || character === '[' || character === '{') {
      delimiters.push(character === '(' ? ')' : character === '[' ? ']' : '}');
      index += 1;
      canEndExpression = false;
      continue;
    }
    if (character === ')' || character === ']' || character === '}') {
      if (delimiters.at(-1) === character) delimiters.pop();
      index += 1;
      canEndExpression = true;
      continue;
    }
    if (character === ';' && delimiters.length === 0) return false;
    if (character === '.') {
      index += source.startsWith('...', index) ? 3 : source.startsWith('?.', index) ? 2 : 1;
      canEndExpression = false;
      continue;
    }
    if (character === ',' || character === ':' || character === '?') {
      index += 1;
      canEndExpression = false;
      continue;
    }
    if ('=+-*/%&|^!~<>'.includes(character)) {
      const operator = source.slice(index).match(
        /^(?:===|!==|>>>|\*\*|&&|\|\||\?\?|=>|==|!=|<=|>=|<<|>>|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[=+\-*/%&|^!~<>])/u,
      )[0];
      index += operator.length;
      canEndExpression = (operator === '++' || operator === '--') && canEndExpression;
      continue;
    }
    index += 1;
  }
  return true;
}

function isThrowExpressionIdentifierPosition(source, offset, literals) {
  const start = Math.max(0, offset - 4096);
  const candidates = [...source.slice(start, offset).matchAll(/\bthrow\b/gu)].reverse();
  const candidate = candidates.find((match) => codeOffset(start + match.index, literals));
  if (candidate === undefined) return false;
  return throwExpressionContainsOffset(source, start + candidate.index, offset, literals);
}

function isExplicitDiagnosticIdentifierPosition(source, offset, literals) {
  const before = source.slice(Math.max(0, offset - 512), offset);
  const outsideRustMatches = !isRustMatchesReference(source, offset);
  const rustResultError = outsideRustMatches && (
    /\breturn\s+Err\s*\(\s*$/u.test(before)
    || (/\bErr\s*\(\s*$/u.test(before) && source.startsWith('code::', offset))
    || /\.(?:ok_or|context)\s*\(\s*$/u.test(before)
    || /\.ok_or_else\s*\(\s*(?:move\s+)?\|\s*\|\s*$/u.test(before)
    || /\.map_err\s*\(\s*(?:move\s+)?\|[^|\r\n]*\|\s*$/u.test(before)
  );
  return (
    isThrowExpressionIdentifierPosition(source, offset, literals)
    || rustResultError
    || /\bnew\s+(?:Snapback)?Error\s*\(\s*(?:&\s*)?$/u.test(before)
    || /\b(?:kitError|requestDiagnostic)\s*\(\s*\d{3}\s*,\s*(?:&\s*)?$/u.test(before)
    || /\b(?:bindingFailure|diagnosticError|codedError|verifyError|codegenError|conformanceDiagnostic|graph_serving_error|__snapbackFail|__snapbackFamiliarFail|snapbackError)\s*\(\s*(?:&\s*)?$/u.test(before)
    || /\b(?:SnapbackError|Diagnostic)::(?:error|warning|info|new)\s*\(\s*(?:&\s*)?$/u.test(before)
    || /\b(?:e?println)!\s*\(\s*(?:&\s*)?$/su.test(before)
    || /\b(?:tracing|log)::[a-z_][a-z0-9_]*!\s*\(\s*(?:&\s*)?$/su.test(before)
    || /\bconsole\.(?:error|warn)\s*\(\s*(?:&\s*)?$/su.test(before)
    || /(?:^|[;&|()])\s*deploy_fail\s+$/u.test(before)
  );
}

function isComparisonOrPrefixCheck(source, offset, code) {
  const before = source.slice(Math.max(0, offset - 128), offset);
  const after = source.slice(offset + code.length, offset + code.length + 128);

  return (
    (/(?:===|!==|==|!=)\s*["'`]$/u.test(before) && /^["'`]/u.test(after))
    || (/["'`]$/u.test(before) && /^["'`]\s*(?:===|!==|==|!=)/u.test(after))
    || (/\bcase\s+["'`]$/u.test(before) && /^["'`]\s*:/u.test(after))
    || (/\.(?:startsWith|starts_with|contains|endsWith|includes|indexOf)\s*\(\s*["'`]$/u.test(before)
      && /^["'`]\s*\)/u.test(after))
  );
}

function isRustMatchArmPattern(source, offset, code) {
  const start = offset + code.length;
  let arrow = -1;
  let braceDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      if (newline === -1) break;
      index = newline;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      if (close === -1) break;
      index = close + 1;
      continue;
    }
    if (source[index] === '{') {
      braceDepth += 1;
      continue;
    }
    if (source[index] === '}') {
      if (braceDepth === 0) break;
      braceDepth -= 1;
      continue;
    }
    if (braceDepth === 0 && source.startsWith('=>', index)) {
      arrow = index;
      break;
    }
  }
  if (arrow === -1) return false;
  const patternTail = source.slice(start, arrow)
    .replace(/\/\/[^\n]*(?:\n|$)/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '');
  return /^["']\s*(?:\|\s*(?:r#*)?["']SNAPBACK_[A-Z0-9_]+["']\s*)*$/u.test(patternTail);
}

function isRustMatchesReference(source, offset) {
  const start = Math.max(0, offset - 4096);
  const before = source.slice(start, offset);
  const candidates = [...before.matchAll(/\bmatches!\s*\(/gu)].reverse();
  const literals = stringLiteralBounds(source, { ordinaryMultiline: true });
  return candidates.some((candidate) => {
    const open = start + candidate.index + candidate[0].lastIndexOf('(');
    const close = matchingDelimiter(source, open, literals);
    return close !== source.length && offset < close;
  });
}

function isCatalogueLiteralContext(source, open) {
  const prefix = source.slice(Math.max(0, open - 2048), open);
  const wrappers = String.raw`(?:(?:Object\.freeze|new\s+Set)\s*\(\s*)?`;
  const catalogueName = String.raw`(?:codes|allowlist|denylist|catalog(?:ue)?|[A-Za-z_$][\w$]*(?:_CODES|_ALLOWLIST|_DENYLIST|_CATALOG(?:UE)?))`;
  return (
    new RegExp(`${catalogueName}\\s*:\\s*${wrappers}$`, 'iu').test(prefix)
    || new RegExp(
      String.raw`\b(?:const|let|var)\s+${catalogueName}\s*=\s*${wrappers}$`,
      'iu',
    ).test(prefix)
    || new RegExp(
      String.raw`\b(?:pub\s+)?(?:const|static)\s+${catalogueName}\s*:[^=]{0,256}=\s*&?${wrappers}$`,
      'iu',
    ).test(prefix)
  );
}

function isCodeReferenceCatalogue(source, offset) {
  const open = source.lastIndexOf('[', offset);
  if (open === -1 || offset - open > 8192) return false;
  const close = source.indexOf(']', offset);
  if (close === -1 || close - open > 8192) return false;
  const contents = source.slice(open + 1, close);
  const quotedCodes = [...contents.matchAll(
    /(?:r#*)?["']SNAPBACK_[A-Z0-9_]+["']/gu,
  )];
  if (quotedCodes.length === 0) return false;
  const remainder = contents
    .replace(/\/\/[^\n]*(?:\n|$)/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(?:r#*)?["']SNAPBACK_[A-Z0-9_]+["']/gu, '')
    .replace(/[\s,]/gu, '');
  if (remainder.length !== 0) return false;
  return quotedCodes.length >= 2 || isCatalogueLiteralContext(source, open);
}

function hasReceivedMembershipConsumer(source, open, close) {
  const prefix = source.slice(Math.max(0, open - 2048), open);
  const direct = prefix.match(
    /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:Object\.freeze|new\s+Set)\s*\()?\s*$/u,
  );
  const property = prefix.match(
    /\b([A-Za-z_$][\w$]*)\s*:\s*(?:Object\.freeze\s*\()?\s*$/u,
  );
  const member = direct?.[1] ?? property?.[1];
  if (member === undefined) return false;

  const after = source.slice(close + 1);
  if (membershipConsumerFor(member, after)) return true;

  for (const derived of source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Set\s*\(([^)]*)\)/gu,
  )) {
    if (!new RegExp(`(?:^|\\.)${escapeRegExp(member)}\\b`, 'u').test(derived[2])) continue;
    const derivedConsumption = new RegExp(
      `\\b${escapeRegExp(derived[1])}\\s*\\.(?:has|includes)\\s*\\(`,
      'u',
    );
    if (derivedConsumption.test(source.slice(derived.index + derived[0].length))) return true;
  }
  return false;
}

function matchingDelimiter(source, open, literals) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [pairs[source[open]]];
  const excluded = literals === undefined
    ? []
    : [
      ...literals.comments,
      ...literals.ranges.map(({ contentStart, end }) => ({ start: contentStart, end })),
      ...(literals.lexicalExcluded ?? []),
    ].sort((left, right) => left.start - right.start || left.end - right.end);
  let excludedIndex = 0;
  let quote = null;
  let escaped = false;
  for (let index = open + 1; index < source.length; index += 1) {
    while (excluded[excludedIndex]?.end <= index) excludedIndex += 1;
    const excludedRange = excluded[excludedIndex];
    if (
      excludedRange !== undefined
      && excludedRange.start <= index
      && index < excludedRange.end
    ) {
      index = excludedRange.end - 1;
      continue;
    }
    const character = source[index];
    if (literals === undefined && quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (literals === undefined && source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      if (newline === -1) return source.length;
      index = newline;
      continue;
    }
    if (literals === undefined && source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      if (close === -1) return source.length;
      index = close + 1;
      continue;
    }
    if (
      literals === undefined
      && (character === '"' || character === "'" || character === '`')
    ) {
      quote = character;
      continue;
    }
    if (pairs[character]) {
      stack.push(pairs[character]);
      continue;
    }
    if (character === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return source.length;
}

function receivedMapGetConsumerFor(member, after) {
  const name = escapeRegExp(member);
  const calls = after.matchAll(new RegExp(
    `(?:\\b(?:Self|self|this)\\.)?\\b${name}\\s*\\.get\\s*\\(\\s*([^()\\r\\n]{1,256}?)\\s*\\)`,
    'gu',
  ));
  for (const call of calls) {
    const key = call[1].replace(/\s+/gu, '');
    if (
      /^(?:(?:received|diagnostic|error|refusal|capability)?(?:record|response|request|payload|input|args?)|(?:received|diagnostic|error|refusal|capability)Code)(?:\?\.[A-Za-z_$][\w$]*|\.[A-Za-z_$][\w$]*)*$/iu.test(key)
    ) return true;
    if (/^`[\s\S]*`$/u.test(key)) {
      const beforeCall = after.slice(0, call.index);
      for (const interpolation of key.matchAll(/\$\{([A-Za-z_$][\w$]*)\}/gu)) {
        const identifier = escapeRegExp(interpolation[1]);
        if (new RegExp(
          `\\b(?:const|let)\\s+${identifier}\\s*=\\s*[A-Za-z_$][\\w$]*(?:\\?\\.|\\.)diagnostic(?:\\?\\.|\\.)code\\b`,
          'u',
        ).test(beforeCall)) return true;
      }
    }
  }
  return false;
}

function membershipConsumerFor(member, after, {
  mapTable = false,
  objectTable = false,
} = {}) {
  const name = escapeRegExp(member);
  if (objectTable) {
    return (
      new RegExp(`\\bin\\s+(?:(?:Self|self|this)\\.)?${name}\\b`, 'u').test(after)
      || new RegExp(`\\bObject\\.hasOwn\\s*\\(\\s*(?:(?:Self|self|this)\\.)?${name}\\s*,`, 'u').test(after)
    );
  }
  return (
    new RegExp(
      `(?:\\b(?:Self|self|this)\\.)?\\b${name}\\s*\\.(?:has|includes|contains|binary_search)\\s*\\(`,
      'u',
    ).test(after)
    || (mapTable && receivedMapGetConsumerFor(member, after))
    || new RegExp(
      `\\bis_code_member\\s*\\(\\s*[^,)]*\\s*,\\s*&?\\s*(?:(?:Self|self)::)?${name}\\b`,
      'u',
    ).test(after)
  );
}

function receivedMembershipTables(source, literals) {
  const tables = [];
  const declarations = [
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:Object\.freeze|new\s+(?:Set|Map)|Set(?:<[^>]+>)?)\s*\(\s*)?([\[{])/gu,
    /\b(?:(?:private|public|internal|fileprivate|open)\s+)?(?:static\s+)?let\s+([A-Za-z_$][\w$]*)\s*:\s*[^=\n]{0,256}=\s*(?:Set(?:<[^>]+>)?\s*\(\s*)?([\[])/gu,
    /\b(?:pub\s+)?(?:const|static)\s+([A-Z][A-Z0-9_]*)\s*:[^=]{0,256}=\s*&?([\[])/gu,
  ];
  for (const pattern of declarations) {
    for (const declaration of source.matchAll(pattern)) {
      const open = declaration.index + declaration[0].lastIndexOf(declaration[2]);
      const close = matchingDelimiter(source, open, literals);
      if (close === source.length) continue;
      const after = source.slice(close + 1);
      const objectTable = declaration[2] === '{';
      const mapTable = /\bnew\s+Map\s*\(\s*\[$/u.test(declaration[0]);
      if (membershipConsumerFor(declaration[1], after, {
        mapTable,
        objectTable,
      })) {
        tables.push({ open, close, mapTable, objectTable });
      }
    }
  }
  return tables;
}

function isMapKeyPosition(source, tableOpen, tableClose, offset, literals) {
  const entryOpen = source.lastIndexOf('[', offset);
  if (entryOpen <= tableOpen) return false;
  const entryClose = matchingDelimiter(source, entryOpen, literals);
  if (entryClose >= tableClose || offset >= entryClose) return false;
  const entryPrefix = source.slice(entryOpen + 1, offset);
  const keyStart = /^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(["'`])/u.exec(
    entryPrefix,
  );
  if (keyStart === null) return false;
  const delimiter = keyStart[1];
  let escaped = false;
  for (
    let index = entryOpen + 1 + keyStart[0].length;
    index < entryClose;
    index += 1
  ) {
    if (escaped) escaped = false;
    else if (source[index] === '\\') escaped = true;
    else if (source[index] === delimiter) return offset < index;
  }
  return false;
}

function receivedProtocolOffsets(source, matches, literals) {
  const offsets = new Set();
  for (const match of matches) {
    if (!isCodeReferenceCatalogue(source, match.index)) continue;
    const open = source.lastIndexOf('[', match.index);
    const close = source.indexOf(']', match.index);
    if (hasReceivedMembershipConsumer(source, open, close)) offsets.add(match.index);
  }
  const tables = receivedMembershipTables(source, literals);
  for (const match of matches) {
    if (tables.some(({ open, close, mapTable, objectTable }) => (
      open < match.index
      && match.index < close
      && (
        (!objectTable && !mapTable)
        || (
          objectTable
          && /^(?:["'])?\s*:/u.test(source.slice(match.index + match[0].length))
        )
        || (mapTable && isMapKeyPosition(source, open, close, match.index, literals))
      )
    ))) {
      offsets.add(match.index);
    }
  }
  return offsets;
}

function isMapCatalogueKeyPosition(source, offset, literals) {
  for (const table of source.matchAll(/\bnew\s+Map\s*\(\s*(\[)/gu)) {
    const open = table.index + table[0].lastIndexOf(table[1]);
    if (open >= offset) break;
    const close = matchingDelimiter(source, open, literals);
    if (
      offset < close
      && isMapKeyPosition(source, open, close, offset, literals)
    ) return true;
  }
  return false;
}

function isReferencePosition(source, offset, code, literals) {
  return (
    isComparisonOrPrefixCheck(source, offset, code)
    || isRustMatchArmPattern(source, offset, code)
    || isRustMatchesReference(source, offset)
    || isCodeReferenceCatalogue(source, offset)
    || isMapCatalogueKeyPosition(source, offset, literals)
  );
}

function shellDiagnosticOperator(source, offset) {
  const bounds = lineBounds(source, offset);
  const before = source.slice(bounds.start, offset);
  if (/(?:^|[;&|()])\s*deploy_fail\s+$/u.test(before)) return 'deploy-fail';
  if (/(?:^|[;&|()])\s*(?:echo|printf)\b[^#]*$/u.test(before)) return 'print';
  return null;
}

function emissionWinsEnvironmentSite(source, match, analysis) {
  const offset = match.index;
  if (
    hasEmissionMarker(source, offset, match[0])
    && !isCommentReference(offset, analysis.literals.comments)
  ) return true;
  // A proven environment site is the stronger syntax even when it is nested
  // inside a broad throw/error shape. This includes helper-mediated reads;
  // explicit emission markers above remain the escape hatch for a genuinely
  // dual-role spelling at one offset.
  if (analysis.siteKinds.has(offset)) return false;
  if (
    isGeneratedSourceDiagnosticPosition(source, match, analysis.literals)
    || isStoredDiagnosticSqlPosition(source, match, analysis.literals)
    || isEscapedPoisonDiagnosticPosition(source, match, analysis.literals)
    || isLeadingDiagnosticCodePosition(source, match, analysis.literals)
  ) return true;
  const literalShape = diagnosticLiteralShape(match, analysis.literals);
  return literalShape === 'prefix'
    || (literalShape === 'whole' && isExplicitDiagnosticCodePosition(source, offset));
}

function diagnosticSiteKind(source, match, analysis, environmentNames, { shell = false } = {}) {
  const offset = match.index;
  if (hasReservedMarker(source, offset, match[0])) return 'reserved';
  if (hasReceivedMarker(source, offset, match[0])) return 'received';
  if (
    hasEmissionMarker(source, offset, match[0])
    && !isCommentReference(offset, analysis.literals.comments)
  ) return 'emission';
  if (isCommentReference(offset, analysis.literals.comments)) return null;
  if (
    (analysis.siteKinds.has(offset) || environmentNames.has(match[0]))
    && emissionWinsEnvironmentSite(source, match, analysis)
  ) return 'emission';
  if (
    hasReferenceOnlyMarker(source, offset)
    || analysis.siteKinds.has(offset)
  ) return null;
  if (analysis.receivedOffsets.has(offset)) return 'received';
  if (analysis.declarations.has(offset)) return 'declaration';
  if (shell) {
    const operator = shellDiagnosticOperator(source, offset);
    return operator === 'deploy-fail' || (operator === 'print' && !environmentNames.has(match[0]))
      ? 'emission'
      : null;
  }
  if (isReferencePosition(source, offset, match[0], analysis.literals)) return null;
  if (isUnrecognizedDiagnosticReference(source, match)) return null;
  if (isHtmlDiagnosticPosition(source, match)) {
    return environmentNames.has(match[0]) ? null : 'emission';
  }
  if (
    isGeneratedSourceDiagnosticPosition(source, match, analysis.literals)
    || isStoredDiagnosticSqlPosition(source, match, analysis.literals)
    || isEscapedPoisonDiagnosticPosition(source, match, analysis.literals)
  ) return 'emission';
  if (
    isLeadingDiagnosticCodePosition(source, match, analysis.literals)
    && !environmentNames.has(match[0])
  ) return 'emission';
  const literalShape = diagnosticLiteralShape(match, analysis.literals);
  if (literalShape === 'prefix') return 'emission';
  if (literalShape !== 'whole') return null;
  if (
    environmentNames.has(match[0])
    && !isExplicitDiagnosticCodePosition(source, offset)
  ) return null;
  return 'emission';
}

function uniqueDiagnosticSourceLines(source, sites) {
  const unique = new Map();
  const priority = (site) => {
    if (site.kind === 'emission') return site.synthetic === true ? 4 : 5;
    if (site.kind === 'reserved') return 3;
    if (site.kind === 'received') return 2;
    return 1;
  };
  for (const site of sites) {
    const key = `${site.match[0]}\0${lineBounds(source, site.match.index).start}`;
    const previous = unique.get(key);
    if (previous === undefined || priority(site) > priority(previous)) unique.set(key, site);
  }
  return [...unique.values()].sort((left, right) => (
    left.match.index - right.match.index || left.match[0].localeCompare(right.match[0])
  ));
}

export function diagnosticSourceSites(source, {
  environmentNames,
  indirectEnvironmentReadContracts: readContracts,
  javascript,
  ordinaryMultiline,
  shell,
  excludeRustTestRegions = false,
  receivedProtocolVocabulary = false,
} = {}) {
  const classifiedSource = excludeRustTestRegions ? rustProductionSource(source) : source;
  const analysis = environmentAnalysis(classifiedSource, {
    indirectEnvironmentReadContracts: readContracts,
    javascript,
    ordinaryMultiline,
    shell,
  });
  const classifiedNames = environmentNames ?? analysis.names;
  analysis.receivedOffsets = receivedProtocolVocabulary
    ? receivedProtocolOffsets(classifiedSource, analysis.matches, analysis.literals)
    : new Set();
  const sites = analysis.matches.flatMap((match) => {
    const kind = diagnosticSiteKind(classifiedSource, match, analysis, classifiedNames, { shell });
    return kind === null ? [] : [{ match, kind }];
  });
  const flowSites = identifierFlowEmissionSites(classifiedSource, analysis);
  sites.push(...flowSites);
  sites.push(...syntheticEmissionSites(classifiedSource, analysis.literals.comments).filter(
    (syntheticSite) => !flowSites.some((flowSite) => (
      flowSite.match[0] === syntheticSite.match[0]
      && lineBounds(classifiedSource, flowSite.match.index).start
        === lineBounds(classifiedSource, syntheticSite.match.index).start
    )),
  ));
  return uniqueDiagnosticSourceLines(classifiedSource, sites);
}

export function diagnosticCodeMatches(source, options) {
  return diagnosticSourceSites(source, options).map(({ match }) => match);
}
