// Framework-neutral helpers for the closed portable search AST.
//
// @ref LLP 0073#query-language — strings are parsed into the structured AST
// before invocation; raw backend search syntax never crosses the wire.

function invalid(message) {
  const error = new TypeError(`SNAPBACK_SEARCH_QUERY_INVALID: ${message}`);
  error.code = 'SNAPBACK_SEARCH_QUERY_INVALID';
  return error;
}

function lexicalInputs(source) {
  const out = [];
  let index = 0;
  while (index < source.length) {
    while (/\s/u.test(source[index] ?? '')) index += 1;
    if (index >= source.length) break;
    let excluded = false;
    if (source[index] === '-') {
      excluded = true;
      index += 1;
    }
    let field;
    const fieldStart = index;
    while (index < source.length && !/[\s:"]/u.test(source[index])) index += 1;
    if (source[index] === ':') {
      field = source.slice(fieldStart, index);
      if (!field) throw invalid('field qualifier requires a field');
      index += 1;
    } else {
      index = fieldStart;
    }
    let value = '';
    let quoted = false;
    if (source[index] === '"') {
      quoted = true;
      index += 1;
      while (index < source.length && source[index] !== '"') {
        value += source[index];
        index += 1;
      }
      if (source[index] !== '"') throw invalid('unmatched quote');
      index += 1;
      if (source[index] === '*') throw invalid('phrases cannot be prefixes');
    } else {
      while (index < source.length && !/\s/u.test(source[index])) {
        value += source[index];
        index += 1;
      }
    }
    if (!value) throw invalid('empty lexical input');
    out.push({ value, quoted, excluded, field });
  }
  return out;
}

function rejectUnpairedSurrogates(source) {
  for (let index = 0; index < source.length; index += 1) {
    const unit = source.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = source.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw invalid('query contains an unpaired UTF-16 surrogate');
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw invalid('query contains an unpaired UTF-16 surrogate');
    }
  }
}

function matchAtom(input, { fields, minPrefixScalars }) {
  let value = input.value;
  const field = input.field;
  if (fields && field && !fields.includes(field)) throw invalid(`unknown search field ${field}`);
  if (input.quoted) return { Phrase: { values: [value], ...(field ? { field } : {}) } };
  const prefix = value.endsWith('*');
  if (value.includes('*') && !prefix) throw invalid('wildcards are admitted only as a final prefix marker');
  if (prefix) {
    value = value.slice(0, -1);
    if ([...value].length < minPrefixScalars) throw invalid(`prefix must contain at least ${minPrefixScalars} scalars`);
    return { Prefix: { value, ...(field ? { field } : {}) } };
  }
  return { Term: { value, ...(field ? { field } : {}) } };
}

/**
 * Parse the intentionally small search-string convenience language into the
 * server's structured SearchQueryAstV1.
 */
export function parseSearchQueryV1(source, {
  fields,
  minPrefixScalars = 2,
} = {}) {
  if (typeof source !== 'string') throw invalid('query must be a string');
  rejectUnpairedSurrogates(source);
  if (fields !== undefined && (!Array.isArray(fields) || fields.some((field) => typeof field !== 'string'))) {
    throw invalid('fields must be an array of declared field names');
  }
  const inputs = lexicalInputs(source.trim());
  if (inputs.length === 0) throw invalid('query requires a positive atom');

  const isOr = (input) => !input.excluded && !input.quoted && !input.field && input.value === 'OR';
  const orIndexes = inputs.flatMap((input, index) => isOr(input) ? [index] : []);
  const anyIndexes = new Set();
  for (const index of orIndexes) {
    const left = inputs[index - 1];
    const right = inputs[index + 1];
    if (!left || !right || isOr(left) || isOr(right) || left.excluded || right.excluded) {
      throw invalid('OR requires positive atoms on both sides');
    }
    anyIndexes.add(index - 1);
    anyIndexes.add(index + 1);
  }
  if (orIndexes.length > 1) {
    const first = orIndexes[0];
    if (orIndexes.some((index, offset) => index !== first + offset * 2)) {
      throw invalid('multiple independent OR groups cannot normalize to the closed query shape');
    }
  }

  const direct = [];
  const excluded = [];
  const any = [];
  let prefixes = 0;
  const positiveIndexes = inputs.flatMap((input, index) => (
    !input.excluded && !isOr(input) ? [index] : []
  ));
  const lastPositiveIndex = positiveIndexes.at(-1);
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (isOr(input)) continue;
    const atom = matchAtom(input, { fields, minPrefixScalars });
    if ('Prefix' in atom) {
      prefixes += 1;
      if (input.excluded || index !== lastPositiveIndex) {
        throw invalid('prefix marker is admitted only on the last positive lexical input');
      }
    }
    if (input.excluded) excluded.push({ Not: atom });
    else if (anyIndexes.has(index)) any.push(atom);
    else direct.push(atom);
  }
  if (direct.length + any.length === 0) throw invalid('query requires a positive atom');
  if (prefixes > 1) throw invalid('query admits at most one prefix atom');
  if (direct.length + any.length > 16 || excluded.length > 8) throw invalid('query exceeds clause bounds');
  return {
    all: [
      ...direct,
      ...(any.length ? [{ Any: any }] : []),
      ...excluded,
    ],
  };
}

export const search = Object.freeze({
  term(value, field) {
    return { Term: { value, ...(field ? { field } : {}) } };
  },
  phrase(values, field) {
    return { Phrase: { values: Array.isArray(values) ? [...values] : [values], ...(field ? { field } : {}) } };
  },
  prefix(value, field) {
    return { Prefix: { value, ...(field ? { field } : {}) } };
  },
  not(atom) {
    return { Not: atom };
  },
  any(...atoms) {
    return { Any: atoms.flat() };
  },
  filter(field, value) {
    return { Filter: { field, op: 'eq', value } };
  },
  all(...clauses) {
    return { all: clauses.flat() };
  },
});
