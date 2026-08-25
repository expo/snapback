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

function lineBounds(source, offset) {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  const nextNewline = source.indexOf('\n', offset);
  return { start, end: nextNewline === -1 ? source.length : nextNewline };
}

function hasSiteMarker(source, offset, marker) {
  const current = lineBounds(source, offset);
  if (source.slice(current.start, current.end).includes(marker)) return true;
  if (current.start === 0) return false;
  const previous = lineBounds(source, current.start - 1);
  return source.slice(previous.start, previous.end).includes(marker);
}

function hasReferenceOnlyMarker(source, offset) {
  return hasSiteMarker(source, offset, REFERENCE_ONLY_MARKER);
}

function hasReservedMarker(source, offset) {
  return hasSiteMarker(source, offset, RESERVED_MARKER);
}

function hasReceivedMarker(source, offset) {
  return hasSiteMarker(source, offset, RECEIVED_MARKER);
}

function hasEmissionMarker(source, offset) {
  return hasSiteMarker(source, offset, EMISSION_MARKER);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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

function directEnvironmentSiteKind(source, offset, code) {
  const before = source.slice(Math.max(0, offset - 256), offset);
  const after = source.slice(offset + code.length, offset + code.length + 128);

  if (
    /\.env_remove\s*\(\s*["']$/u.test(before)
    || /\b(?:std::)?env::remove_var\s*\(\s*(?:r#*)?["']$/u.test(before)
    || /\bdelete\s+(?:process|Bun)\.env(?:\.|\?\.)$/u.test(before)
    || (
      /\bdelete\s+(?:process|Bun)\.env(?:\?\.)?\[\s*["']$/u.test(before)
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
  for (const returned of context.matchAll(/\breturn\s*\{/gu)) {
    const open = contextStart + returned.index + returned[0].lastIndexOf('{');
    const beforeReturn = source.slice(Math.max(0, open - 4096), open);
    const functions = [...beforeReturn.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/gu)];
    if (isEnvironmentIdentifier(functions.at(-1)?.[1] ?? '')) {
      candidates.push({ kind: 'table-entry', open });
    }
  }
  return candidates.sort((left, right) => right.open - left.open).find(({ open }) => {
    let depth = 0;
    for (const character of source.slice(open, offset)) {
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    return depth > 0;
  })?.kind ?? null;
}

function isEnvironmentNameTable(source, offset) {
  const open = Math.max(source.lastIndexOf('{', offset), source.lastIndexOf('[', offset));
  if (open === -1) return false;
  const prefix = source.slice(Math.max(0, open - 1024), open);
  const javaScriptDeclaration = prefix.match(
    /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:Object\.freeze|new\s+Set)\s*\()?\s*$/u,
  );
  if (javaScriptDeclaration !== null) {
    return isEnvironmentIdentifier(javaScriptDeclaration[1]);
  }
  const rustDeclaration = prefix.match(
    /\b(?:pub\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:[^=]+?=\s*&?\s*$/su,
  );
  return rustDeclaration !== null && isEnvironmentIdentifier(rustDeclaration[1]);
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
    if (dynamicRead.test(body)) helpers.add(declaration[1]);
  }
  for (const declaration of source.matchAll(
    /(?:^|[;{},]\s*|\n\s*)(?:static\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*=>\s*([^;\n]+)/gmu,
  )) {
    const parameter = escapeRegExp(declaration[2]);
    const dynamicRead = new RegExp(
      `(?:process\\.env(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|(?:this\\.)?(?:env|environment)(?:\\?\\.)?\\[\\s*${parameter}\\s*\\])`,
      'u',
    );
    if (dynamicRead.test(declaration[3])) helpers.add(declaration[1]);
  }
  for (const declaration of source.matchAll(
    /(?:^|[;{},]\s*|\n\s*)(?:static\s+)?([A-Za-z_$][\w$]*)\s*(?:=|:)\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>\s*([^;\n]+)/gmu,
  )) {
    const parameter = escapeRegExp(declaration[2]);
    const dynamicRead = new RegExp(
      `(?:process\\.env(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|(?:this\\.)?(?:env|environment)(?:\\?\\.)?\\[\\s*${parameter}\\s*\\])`,
      'u',
    );
    if (dynamicRead.test(declaration[3])) helpers.add(declaration[1]);
  }
  return helpers;
}

function indirectEnvironmentHelperOffsets(source, matches) {
  const helpers = [...environmentHelperNames(source)];
  if (helpers.length === 0) return new Set();
  const call = new RegExp(
    `\\b(?:${helpers.map(escapeRegExp).join('|')})\\s*\\(\\s*["']$`,
    'u',
  );
  return new Set(matches.filter((match) => (
    call.test(source.slice(Math.max(0, match.index - 256), match.index))
  )).map((match) => match.index));
}

function stringLiteralBounds(source, { ordinaryMultiline = false } = {}) {
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

function environmentAnalysis(source, options) {
  const matches = [...source.matchAll(DIAGNOSTIC_CODE_PATTERN)];
  const literals = stringLiteralBounds(source, options);
  const siteKinds = new Map();
  for (const offset of rustIndirectEnvironmentOffsets(source)) {
    siteKinds.set(offset, 'indirect-read');
  }
  for (const offset of javaScriptIndirectEnvironmentOffsets(source)) {
    siteKinds.set(offset, 'declaration');
  }
  for (const offset of indirectEnvironmentHelperOffsets(source, matches)) {
    siteKinds.set(offset, 'read');
  }
  for (const match of matches) {
    // Comments are references first; `process.env.SNAPBACK_X` in explanatory
    // prose must not become an environment read site.
    if (isCommentReference(match.index, literals.comments)) {
      siteKinds.delete(match.index);
      continue;
    }
    const directKind = directEnvironmentSiteKind(source, match.index, match[0]);
    const objectKind = javaScriptEnvironmentObjectKind(source, match.index, match[0]);
    if (directKind !== null) {
      siteKinds.set(match.index, directKind);
    } else if (objectKind !== null) {
      siteKinds.set(match.index, objectKind);
    } else if (isEnvironmentNameTable(source, match.index)) {
      siteKinds.set(match.index, 'table-entry');
    }
  }
  const names = new Set(matches
    .filter((match) => siteKinds.has(match.index))
    .map((match) => match[0]));
  return { literals, matches, names, siteKinds, receivedOffsets: new Set() };
}

export function environmentVariableSites(source, { environmentNames, ordinaryMultiline } = {}) {
  const analysis = environmentAnalysis(source, { ordinaryMultiline });
  const classifiedNames = environmentNames ?? analysis.names;
  return analysis.matches.flatMap((match) => {
    const kind = analysis.siteKinds.get(match.index);
    if (kind !== undefined) return [{ match, kind }];
    if (
      classifiedNames.has(match[0])
      && diagnosticSiteKind(source, match, analysis, classifiedNames) === null
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

function isComparisonOrPrefixCheck(source, offset, code) {
  const before = source.slice(Math.max(0, offset - 128), offset);
  const after = source.slice(offset + code.length, offset + code.length + 128);

  return (
    (/(?:===|!==|==|!=)\s*["'`]$/u.test(before) && /^["'`]/u.test(after))
    || (/["'`]$/u.test(before) && /^["'`]\s*(?:===|!==|==|!=)/u.test(after))
    || (/\bcase\s+["'`]$/u.test(before) && /^["'`]\s*:/u.test(after))
    || (/\.(?:startsWith|starts_with|contains|endsWith)\s*\(\s*["'`]$/u.test(before)
      && /^["'`]\s*\)/u.test(after))
  );
}

function isRustMatchArmPattern(source, offset, code) {
  const after = source.slice(offset + code.length, offset + code.length + 8192);
  const arrow = after.indexOf('=>');
  if (arrow === -1) return false;
  const patternTail = after.slice(0, arrow)
    .replace(/\/\/[^\n]*(?:\n|$)/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '');
  return /^["']\s*(?:\|\s*(?:r#*)?["']SNAPBACK_[A-Z0-9_]+["']\s*)*$/u.test(patternTail);
}

function isRustMatchesReference(source, offset) {
  const before = source.slice(Math.max(0, offset - 4096), offset);
  return /\bmatches!\s*\([^;{}]*$/su.test(before);
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
  if (quotedCodes.length < 2) return false;
  const remainder = contents
    .replace(/\/\/[^\n]*(?:\n|$)/gu, '')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(?:r#*)?["']SNAPBACK_[A-Z0-9_]+["']/gu, '')
    .replace(/[\s,]/gu, '');
  return remainder.length === 0;
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
  const directConsumption = new RegExp(
    `\\b${escapeRegExp(member)}\\s*\\.(?:has|includes)\\s*\\(`,
    'u',
  );
  if (directConsumption.test(after)) return true;

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

function receivedProtocolOffsets(source, matches) {
  const offsets = new Set();
  for (const match of matches) {
    if (!isCodeReferenceCatalogue(source, match.index)) continue;
    const open = source.lastIndexOf('[', match.index);
    const close = source.indexOf(']', match.index);
    if (hasReceivedMembershipConsumer(source, open, close)) offsets.add(match.index);
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

function diagnosticSiteKind(source, match, analysis, environmentNames) {
  const offset = match.index;
  if (hasReservedMarker(source, offset)) return 'reserved';
  if (hasEmissionMarker(source, offset)) return 'emission';
  if (hasReceivedMarker(source, offset)) return 'received';
  if (isCommentReference(offset, analysis.literals.comments)) return null;
  if (
    hasReferenceOnlyMarker(source, offset)
    || analysis.siteKinds.has(offset)
  ) return null;
  if (analysis.receivedOffsets.has(offset)) return 'received';
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
  ordinaryMultiline,
  receivedProtocolVocabulary = false,
} = {}) {
  const analysis = environmentAnalysis(source, { ordinaryMultiline });
  analysis.receivedOffsets = receivedProtocolVocabulary
    ? receivedProtocolOffsets(source, analysis.matches)
    : new Set();
  const classifiedNames = environmentNames ?? analysis.names;
  return analysis.matches.flatMap((match) => {
    const kind = diagnosticSiteKind(source, match, analysis, classifiedNames);
    return kind === null ? [] : [{ match, kind }];
  });
}

export function diagnosticCodeMatches(source, options) {
  return diagnosticSourceSites(source, options).map(({ match }) => match);
}
