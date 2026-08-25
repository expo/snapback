export const DIAGNOSTIC_CODE_PATTERN = /(?<![A-Z0-9_])SNAPBACK_[A-Z0-9_]*[A-Z0-9](?![A-Z0-9_])/gu;
const REFERENCE_ONLY_MARKER = 'diagnostics-registry: reference-only';
const RESERVED_MARKER = 'diagnostics-registry: reserved';
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
  const byContentStart = new Map();
  const ranges = [];
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
    const literal = { contentStart, end: cursor };
    byContentStart.set(contentStart, literal);
    ranges.push(literal);
    index = cursor + closingDelimiter.length;
  }
  return { byContentStart, ranges };
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
    if (isCommentReference(source, match.index)) {
      siteKinds.delete(match.index);
      continue;
    }
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
      && analysis.literals.byContentStart.has(match.index)
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
  if (isCommentReference(source, offset)) return null;
  if (
    hasReferenceOnlyMarker(source, offset)
    || analysis.siteKinds.has(offset)
  ) return null;
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
