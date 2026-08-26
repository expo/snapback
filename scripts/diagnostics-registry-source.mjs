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

function javaScriptEnvironmentObjectKind(source, offset, code) {
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
        kind: 'table-entry',
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
      candidates.push({ kind: 'table-entry', open });
    }
  }
  return candidates.sort((left, right) => right.open - left.open)
    .find(({ open }) => matchingDelimiter(source, open) > offset)?.kind ?? null;
}

function environmentNameTables(source, literals) {
  const tables = [];
  for (const { open, close } of lexicalDelimiterPairs(source, literals)) {
    if (source[open] !== '[' && source[open] !== '{') continue;
    const prefix = source.slice(Math.max(0, open - 2048), open);
    const javaScriptDeclaration = prefix.match(
      /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:Object\.freeze|new\s+Set)\s*\(\s*)?$/u,
    );
    const rustDeclaration = prefix.match(
      /\b(?:pub\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:[^=;]{0,512}=\s*&?\s*$/u,
    );
    const identifier = javaScriptDeclaration?.[1] ?? rustDeclaration?.[1];
    if (identifier !== undefined && isEnvironmentIdentifier(identifier)) {
      tables.push({ open, close });
    }
  }
  return tables;
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

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return source.length;
}

function environmentHelperNames(source) {
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
    const body = source.slice(open, matchingBrace(source, open) + 1);
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
    const body = source.slice(open, matchingBrace(source, open) + 1);
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

function helperObjectCallContains(source, helper, offset) {
  const callPattern = new RegExp(`\\b${escapeRegExp(helper)}\\s*\\(\\s*\\{`, 'gu');
  for (const call of source.matchAll(callPattern)) {
    const open = call.index + call[0].lastIndexOf('{');
    if (open >= offset) break;
    if (matchingBrace(source, open) > offset) return true;
  }
  return false;
}

function indirectEnvironmentHelperOffsets(source, matches, readContracts) {
  const helpers = [...environmentHelperNames(source)];
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
      && helperObjectCallContains(source, helper, match.index)
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
      ? source.slice(Math.max(0, index - 32), index).match(/(?:^|[^A-Za-z0-9_])(?:br|r)(#+)$/u)
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
    ? tail.match(/^(?:\s*#\[[^\]]+\])*\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*/u)
    : tail.match(/^(?:\s*#\[[^\]]+\])*\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern(?:\s+"[^"]+")?)\s+)*fn\s+[A-Za-z_][A-Za-z0-9_]*\b/u);
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
    const kind = attribute[1].startsWith('cfg') ? 'module' : 'function';
    const open = rustDeclarationBrace(
      source,
      attribute.index + attribute[0].length,
      kind,
      literals,
    );
    if (open === null) continue;
    const close = delimiterCloses.get(open);
    if (close === undefined) continue;
    ranges.push({ start: attribute.index, end: close + 1 });
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
    || /\bnew\s+Error\s*\(\s*["'`]$/u.test(before)
    || /\b(?:code|diagnosticCode|diagnostic_code|errorCode|error_code)\s*:\s*["'`]$/u.test(before)
    || /\.code\s*=\s*["'`]$/u.test(before)
    || /\b(?:kitError|requestDiagnostic)\s*\(\s*\d{3}\s*,\s*["'`]$/u.test(before)
    || /\b(?:diagnosticError|codedError|verifyError|codegenError|conformanceDiagnostic|graph_serving_error|__snapbackFail|__snapbackFamiliarFail|snapbackError)\s*\(\s*["'`]$/u.test(before)
    || /\b(?:SnapbackError|Diagnostic)::(?:error|warning|info|new)\s*\(\s*["'`]$/u.test(before)
  );
}

function isRustDiagnosticPrintPosition(source, offset) {
  const before = source.slice(Math.max(0, offset - 512), offset);
  return /\b(?:(?:e?println)!|(?:tracing|log)::[a-z_][a-z0-9_]*!)\s*\([^;{}]*(?:r#*)?"$/su.test(before);
}

function isLeadingDiagnosticCodePosition(source, match, literals) {
  const literal = literals.byContentStart.get(match.index);
  if (literal === undefined) return false;
  const end = match.index + match[0].length;
  if (literal.end !== end && !/^[:\s]/u.test(source.slice(end, end + 1))) return false;
  return isExplicitDiagnosticCodePosition(source, match.index)
    || isRustDiagnosticPrintPosition(source, match.index);
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
  if (before.endsWith('${') && /^(?:\}|[:#%/?+=-])/u.test(after)) return 'read';
  if (before.endsWith('$') && !/[\\$]\$$/u.test(before)) return 'read';
  return null;
}

function environmentAnalysis(source, options) {
  const matches = [...source.matchAll(DIAGNOSTIC_CODE_PATTERN)];
  const literals = stringLiteralBounds(source, options);
  const nameTables = environmentNameTables(source, literals);
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
    const objectKind = javaScriptEnvironmentObjectKind(source, match.index, match[0]);
    if (shellKind !== null) {
      siteKinds.set(match.index, shellKind);
    } else if (directKind !== null) {
      siteKinds.set(match.index, directKind);
    } else if (objectKind !== null) {
      siteKinds.set(match.index, objectKind);
    } else if (nameTables.some(({ open, close }) => open < match.index && match.index < close)) {
      siteKinds.set(match.index, 'table-entry');
    }
  }
  const names = new Set(matches
    .filter((match) => siteKinds.has(match.index))
    .map((match) => match[0]));
  return { literals, matches, names, siteKinds, receivedOffsets: new Set() };
}

export function environmentVariableSites(source, {
  environmentNames,
  indirectEnvironmentReadContracts: readContracts,
  javascript,
  ordinaryMultiline,
  shell,
  excludeRustTestRegions = false,
} = {}) {
  const classifiedSource = excludeRustTestRegions ? rustProductionSource(source) : source;
  const analysis = environmentAnalysis(classifiedSource, {
    indirectEnvironmentReadContracts: readContracts,
    javascript,
    ordinaryMultiline,
    shell,
  });
  const classifiedNames = environmentNames ?? analysis.names;
  return analysis.matches.flatMap((match) => {
    const kind = analysis.siteKinds.get(match.index);
    if (kind !== undefined) return [{ match, kind }];
    if (
      classifiedNames.has(match[0])
      && diagnosticSiteKind(classifiedSource, match, analysis, classifiedNames, { shell }) === null
      && analysis.literals.byContentStart.has(match.index)
      && !isCommentReference(match.index, analysis.literals.comments)
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
  const before = source.slice(Math.max(0, offset - 4096), offset);
  return /\bmatches!\s*\([^;{}]*$/su.test(before);
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

function matchingDelimiter(source, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [pairs[source[open]]];
  let quote = null;
  let escaped = false;
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      if (newline === -1) return source.length;
      index = newline;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      if (close === -1) return source.length;
      index = close + 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
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

function membershipConsumerFor(member, after, { objectTable = false } = {}) {
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
    || new RegExp(
      `\\bis_code_member\\s*\\(\\s*[^,)]*\\s*,\\s*&?\\s*(?:(?:Self|self)::)?${name}\\b`,
      'u',
    ).test(after)
  );
}

function receivedMembershipTables(source) {
  const tables = [];
  const declarations = [
    /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:Object\.freeze|new\s+(?:Set|Map)|Set(?:<[^>]+>)?)\s*\(\s*)?([\[{])/gu,
    /\b(?:(?:private|public|internal|fileprivate|open)\s+)?(?:static\s+)?let\s+([A-Za-z_$][\w$]*)\s*:\s*[^=\n]{0,256}=\s*(?:Set(?:<[^>]+>)?\s*\(\s*)?([\[])/gu,
    /\b(?:pub\s+)?(?:const|static)\s+([A-Z][A-Z0-9_]*)\s*:[^=]{0,256}=\s*&?([\[])/gu,
  ];
  for (const pattern of declarations) {
    for (const declaration of source.matchAll(pattern)) {
      const open = declaration.index + declaration[0].lastIndexOf(declaration[2]);
      const close = matchingDelimiter(source, open);
      if (close === source.length) continue;
      const after = source.slice(close + 1);
      const objectTable = declaration[2] === '{';
      if (membershipConsumerFor(declaration[1], after, {
        objectTable,
      })) {
        tables.push({ open, close, objectTable });
      }
    }
  }
  return tables;
}

function receivedProtocolOffsets(source, matches, environmentNames) {
  const offsets = new Set();
  for (const match of matches) {
    if (environmentNames.has(match[0])) continue;
    if (!isCodeReferenceCatalogue(source, match.index)) continue;
    const open = source.lastIndexOf('[', match.index);
    const close = source.indexOf(']', match.index);
    if (hasReceivedMembershipConsumer(source, open, close)) offsets.add(match.index);
  }
  const tables = receivedMembershipTables(source);
  for (const match of matches) {
    if (environmentNames.has(match[0])) continue;
    if (tables.some(({ open, close, objectTable }) => (
      open < match.index
      && match.index < close
      && (
        !objectTable
        || /^(?:["'])?\s*:/u.test(source.slice(match.index + match[0].length))
      )
    ))) {
      offsets.add(match.index);
    }
  }
  return offsets;
}

function isReferencePosition(source, offset, code) {
  return (
    isComparisonOrPrefixCheck(source, offset, code)
    || isRustMatchArmPattern(source, offset, code)
    || isRustMatchesReference(source, offset)
    || isCodeReferenceCatalogue(source, offset)
  );
}

function shellDiagnosticOperator(source, offset) {
  const bounds = lineBounds(source, offset);
  const before = source.slice(bounds.start, offset);
  if (/(?:^|[;&|()])\s*deploy_fail\s+$/u.test(before)) return 'deploy-fail';
  if (/(?:^|[;&|()])\s*(?:echo|printf)\b[^#]*$/u.test(before)) return 'print';
  return null;
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
    hasReferenceOnlyMarker(source, offset)
    || analysis.siteKinds.has(offset)
  ) return null;
  if (analysis.receivedOffsets.has(offset)) return 'received';
  if (shell) {
    const operator = shellDiagnosticOperator(source, offset);
    return operator === 'deploy-fail' || (operator === 'print' && !environmentNames.has(match[0]))
      ? 'emission'
      : null;
  }
  if (isReferencePosition(source, offset, match[0])) return null;
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
    ? receivedProtocolOffsets(classifiedSource, analysis.matches, classifiedNames)
    : new Set();
  const sites = analysis.matches.flatMap((match) => {
    const kind = diagnosticSiteKind(classifiedSource, match, analysis, classifiedNames, { shell });
    return kind === null ? [] : [{ match, kind }];
  });
  sites.push(...syntheticEmissionSites(classifiedSource, analysis.literals.comments));
  return sites.sort((left, right) => (
    left.match.index - right.match.index || left.match[0].localeCompare(right.match[0])
  ));
}

export function diagnosticCodeMatches(source, options) {
  return diagnosticSourceSites(source, options).map(({ match }) => match);
}
