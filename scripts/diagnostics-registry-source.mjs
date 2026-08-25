export const DIAGNOSTIC_CODE_PATTERN = /SNAPBACK_[A-Z0-9_]+/gu;
const REFERENCE_ONLY_MARKER = 'diagnostics-registry: reference-only';

function lineBounds(source, offset) {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  const nextNewline = source.indexOf('\n', offset);
  return { start, end: nextNewline === -1 ? source.length : nextNewline };
}

function hasReferenceOnlyMarker(source, offset) {
  const current = lineBounds(source, offset);
  if (source.slice(current.start, current.end).includes(REFERENCE_ONLY_MARKER)) return true;
  if (current.start === 0) return false;
  const previous = lineBounds(source, current.start - 1);
  return source.slice(previous.start, previous.end).includes(REFERENCE_ONLY_MARKER);
}

function isEnvironmentVariableAccess(source, offset) {
  const before = source.slice(Math.max(0, offset - 256), offset);

  // Rust: std::env::var(_os), env::var(_os), and imported var_os.
  if (/(?:\b(?:std::)?env::(?:var|var_os)|\bvar_os)\s*\(\s*(?:r#*)?["']$/u.test(before)) {
    return true;
  }

  // JavaScript: direct process/Bun properties, bracket access, Deno access,
  // and the common `(options.env ?? process.env).NAME` dependency-injection shape.
  return (
    /\b(?:process|Bun)\.env(?:\.|\?\.)$/u.test(before)
    || /\b(?:process|Bun)\.env(?:\?\.)?\[\s*["']$/u.test(before)
    || /\bDeno\.env\.(?:get|has)\s*\(\s*["']$/u.test(before)
    || /\bprocess\.env\)\s*\.$/u.test(before)
  );
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

export function isEmittingDiagnosticSite(source, match) {
  const code = match[0];
  const offset = match.index;
  return !(
    hasReferenceOnlyMarker(source, offset)
    || isEnvironmentVariableAccess(source, offset)
    || isJavaScriptComparison(source, offset, code)
  );
}

export function diagnosticCodeMatches(source) {
  return [...source.matchAll(DIAGNOSTIC_CODE_PATTERN)]
    .filter((match) => isEmittingDiagnosticSite(source, match));
}
