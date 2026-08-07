const TODO_OPTIONAL_FIELDS = Object.freeze(['note']);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const canonicalObject = (value) => Object.fromEntries(
  Object.entries(value).sort(([left], [right]) => compareText(left, right)),
);

// The server's typed query surface represents an unset optional as null. Keep
// the witness tolerant of carrier serialization at exactly one early seam,
// then compare only this explicit, sorted representation everywhere else.
export function canonicalizeTodos(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const normalized = { ...row };
      for (const field of TODO_OPTIONAL_FIELDS) {
        if (normalized[field] === undefined) normalized[field] = null;
      }
      return canonicalObject(normalized);
    })
    .sort((left, right) => compareText(String(left._id), String(right._id)));
}

export function canonicalTodoJson(canonicalRows) {
  return JSON.stringify(canonicalRows);
}
