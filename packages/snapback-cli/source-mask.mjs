// One source masker shared by every seam that must read JavaScript structure
// without being fooled by its comments or string literals.
//
// `maskStrings: false` keeps string literals intact, which matters when the
// caller's decision depends on an exact module specifier or provider name; the
// default blanks them, which matters when the caller is scanning for
// identifiers and must not match one inside a string.

export function maskInitSourceCommentsAndStrings(source, maskStrings = true) {
  let output = '';
  let state = 'code';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (character === '\n' || character === '\r') {
        state = 'code';
        output += character;
      } else output += ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        output += '  ';
        index += 1;
        state = 'code';
      } else output += character === '\n' || character === '\r' ? character : ' ';
      continue;
    }
    if (state === 'string') {
      output += !maskStrings || character === '\n' || character === '\r' ? character : ' ';
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) {
        state = 'code';
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      output += '  ';
      index += 1;
      state = 'line-comment';
    } else if (character === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'block-comment';
    } else if (character === "'" || character === '"' || character === '`') {
      output += maskStrings ? ' ' : character;
      state = 'string';
      quote = character;
    } else output += character;
  }
  return output;
}
