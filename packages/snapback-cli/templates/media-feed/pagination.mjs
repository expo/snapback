/**
 * Merge whole-result page deliveries into the append-only feed archive.
 *
 * Rows still present in the live head stay query-owned. Rows displaced from
 * the previous head by a newer insert move into the archive, alongside rows
 * from the requested older page. The canonical id deduplicates overlapping
 * deliveries and the immutable page key restores global order.
 *
 * @template {{ _id: string, pageKey: string }} Row
 * @param {{
 *   archive: readonly Row[],
 *   head: readonly Row[],
 *   page?: readonly Row[],
 *   previousHead?: readonly Row[],
 * }} input
 * @returns {readonly Row[]}
 */
export function mergePagedArchive({ archive, head, page = [], previousHead = [] }) {
  const headIds = new Set(head.map((row) => row._id));
  const byId = new Map();
  for (const row of [...previousHead, ...page, ...archive]) {
    if (!headIds.has(row._id) && !byId.has(row._id)) byId.set(row._id, row);
  }
  const merged = [...byId.values()].sort((left, right) => (
    left.pageKey < right.pageKey ? 1 : left.pageKey > right.pageKey ? -1 : 0
  ));
  return merged.length === archive.length && merged.every((row, index) => row === archive[index])
    ? archive
    : merged;
}
