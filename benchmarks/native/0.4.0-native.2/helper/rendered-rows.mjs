/**
 * Reconcile the last native viewability report with current committed data.
 * Removed items disappear even if a list never reports their unmount, and a
 * recycled key resolves to the current item rather than a retained object.
 */
export function reconcileRenderedRows(data, renderedKeys, keyFor, toObservation, inverted = false) {
  const rendered = new Set(renderedKeys.map(String));
  const seen = new Set();
  const rows = [];
  data.forEach((item, index) => {
    const key = String(keyFor(item, index));
    if (seen.has(key) || !rendered.has(key)) return;
    seen.add(key);
    const row = toObservation(item);
    if (row != null) rows.push(row);
  });
  return inverted ? rows.reverse() : rows;
}

export function committedSearchResultIds(token, rows) {
  if (typeof token !== 'string' || token.trim() === '') return [];
  return rows.map(row => row.messageId);
}
