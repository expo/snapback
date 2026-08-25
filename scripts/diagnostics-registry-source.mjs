export const DIAGNOSTIC_CODE_PATTERN = /(?<![A-Z0-9_])SNAPBACK_[A-Z0-9_]+/gu;
const REFERENCE_ONLY_MARKER = 'diagnostics-registry: reference-only';
const RESERVED_MARKER = 'diagnostics-registry: reserved';

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

function isDirectEnvironmentVariableAccess(source, offset) {
  const before = source.slice(Math.max(0, offset - 256), offset);

  // Rust: compile-time env macros, std::env::var(_os), env::var(_os), and
  // imported var_os.
  if (/(?:\b(?:option_env!|env!)|\b(?:std::)?env::(?:var|var_os)|\bvar_os)\s*\(\s*(?:r#*)?["']$/u.test(before)) {
    return true;
  }
  if (/\.(?:env|env_remove)\s*\(\s*["']$/u.test(before)) return true;

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
  );
}

function isJavaScriptEnvironmentObjectKey(source, offset, code) {
  const after = source.slice(offset + code.length, offset + code.length + 16);
  if (!/^\s*:/u.test(after)) return false;

  const contextStart = Math.max(0, offset - 4096);
  const context = source.slice(contextStart, offset);
  const candidates = [];
  for (const assignment of context.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\s*\()?\s*\{/gu,
  )) {
    if (isEnvironmentIdentifier(assignment[1])) {
      candidates.push(contextStart + assignment.index + assignment[0].lastIndexOf('{'));
    }
  }
  for (const property of context.matchAll(/\b(?:env|environment)\s*:\s*\{/gu)) {
    candidates.push(contextStart + property.index + property[0].lastIndexOf('{'));
  }
  for (const returned of context.matchAll(/\breturn\s*\{/gu)) {
    const open = contextStart + returned.index + returned[0].lastIndexOf('{');
    const beforeReturn = source.slice(Math.max(0, open - 4096), open);
    const functions = [...beforeReturn.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/gu)];
    if (isEnvironmentIdentifier(functions.at(-1)?.[1] ?? '')) candidates.push(open);
  }
  return candidates.some((open) => {
    let depth = 0;
    for (const character of source.slice(open, offset)) {
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    return depth > 0;
  });
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
  for (const declaration of source.matchAll(
    /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*["'](SNAPBACK_[A-Z0-9_]+)["']/gu,
  )) {
    if (!isEnvironmentIdentifier(declaration[1])) continue;
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
  const declarations = [
    ...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{/gu),
    ...source.matchAll(/\bfn\s+([a-z_][a-z0-9_]*)\s*\(\s*([a-z_][a-z0-9_]*)[^)]*\)\s*[^{}]*\{/gu),
  ];
  for (const declaration of declarations) {
    const open = declaration.index + declaration[0].lastIndexOf('{');
    const body = source.slice(open, matchingBrace(source, open) + 1);
    const parameter = escapeRegExp(declaration[2]);
    const dynamicRead = new RegExp(
      `(?:process\\.env(?:\\?\\.)?\\[\\s*${parameter}\\s*\\]|(?:std::)?env::(?:var|var_os)\\(\\s*${parameter}\\s*\\))`,
      'u',
    );
    if (dynamicRead.test(body)) helpers.add(declaration[1]);
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
  const literals = new Map();
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      index = close === -1 ? source.length : close + 2;
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
    literals.set(contentStart, { end: cursor });
    index = cursor + closingDelimiter.length;
  }
  return literals;
}

function diagnosticLiteralShape(match, literals) {
  const literal = literals.get(match.index);
  if (literal === undefined) return null;
  if (literal.end === match.index + match[0].length) return 'whole';
  if (match.input[match.index + match[0].length] === ':') return 'prefix';
  return 'reference';
}

function isExplicitDiagnosticCodePosition(source, offset) {
  const before = source.slice(Math.max(0, offset - 512), offset);
  return (
    /\bthrow\b[^;\n]*$/u.test(before)
    || /\bnew\s+Error\s*\(\s*["'`]$/u.test(before)
    || /\b(?:code|diagnosticCode|diagnostic_code|errorCode|error_code)\s*:\s*["'`]$/u.test(before)
    || /\.code\s*=\s*["'`]$/u.test(before)
    || /\b(?:diagnosticError|codedError|verifyError|codegenError|conformanceDiagnostic|graph_serving_error)\s*\(\s*["'`]$/u.test(before)
    || /\b(?:SnapbackError|Diagnostic)::(?:error|warning|info|new)\s*\(\s*["'`]$/u.test(before)
  );
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
    if (isDirectEnvironmentVariableAccess(source, match.index)) {
      siteKinds.set(match.index, 'read');
    } else if (
      isJavaScriptEnvironmentObjectKey(source, match.index, match[0])
      || isEnvironmentNameTable(source, match.index)
    ) {
      siteKinds.set(match.index, 'table-entry');
    }
  }
  const names = new Set(matches
    .filter((match) => siteKinds.has(match.index))
    .map((match) => match[0]));
  return { literals, matches, names, siteKinds };
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
      && diagnosticLiteralShape(match, analysis.literals) !== null
      && !isCommentReference(source, match.index)
    ) {
      return [{ match, kind: 'mention' }];
    }
    return [];
  });
}

function isCommentReference(source, offset) {
  const current = lineBounds(source, offset);
  const beforeOnLine = source.slice(current.start, offset);
  for (let marker = beforeOnLine.indexOf('//'); marker !== -1; marker = beforeOnLine.indexOf('//', marker + 2)) {
    const preceding = beforeOnLine.slice(0, marker);
    const insideQuotedText = ['"', "'", '`'].some((quote) => {
      let count = 0;
      for (let index = 0; index < preceding.length; index += 1) {
        if (preceding[index] !== quote) continue;
        let backslashes = 0;
        for (let cursor = index - 1; cursor >= 0 && preceding[cursor] === '\\'; cursor -= 1) {
          backslashes += 1;
        }
        if (backslashes % 2 === 0) count += 1;
      }
      return count % 2 === 1;
    });
    if (!insideQuotedText) return true;
  }
  const trimmed = beforeOnLine.trimStart();
  return trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function isJavaScriptComparison(source, offset, code) {
  const before = source.slice(Math.max(0, offset - 128), offset);
  const after = source.slice(offset + code.length, offset + code.length + 128);

  return (
    (/(?:===|!==|==|!=)\s*["'`]$/u.test(before) && /^["'`]/u.test(after))
    || (/["'`]$/u.test(before) && /^["'`]\s*(?:===|!==|==|!=)/u.test(after))
    || (/\bcase\s+["'`]$/u.test(before) && /^["'`]\s*:/u.test(after))
  );
}

function diagnosticSiteKind(source, match, analysis, environmentNames) {
  const offset = match.index;
  if (hasReservedMarker(source, offset)) return 'reserved';
  if (
    hasReferenceOnlyMarker(source, offset)
    || analysis.siteKinds.has(offset)
    || isCommentReference(source, offset)
    || isJavaScriptComparison(source, offset, match[0])
  ) return null;
  const literalShape = diagnosticLiteralShape(match, analysis.literals);
  if (literalShape === 'prefix') return 'emission';
  if (literalShape !== 'whole') return null;
  if (
    environmentNames.has(match[0])
    && !isExplicitDiagnosticCodePosition(source, offset)
  ) return null;
  return 'emission';
}

export function diagnosticSourceSites(source, { environmentNames, ordinaryMultiline } = {}) {
  const analysis = environmentAnalysis(source, { ordinaryMultiline });
  const classifiedNames = environmentNames ?? analysis.names;
  return analysis.matches.flatMap((match) => {
    const kind = diagnosticSiteKind(source, match, analysis, classifiedNames);
    return kind === null ? [] : [{ match, kind }];
  });
}

export function diagnosticCodeMatches(source, options) {
  return diagnosticSourceSites(source, options).map(({ match }) => match);
}
