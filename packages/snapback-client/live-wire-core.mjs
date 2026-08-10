// Small pure core shared by the live client and the cross-arm fixture lane.
// Keeping version admission and `_id` delta application here makes the LLP
// 0095 corpus exercise the exact reducer used by liveQuery, not a test copy.
// @ref LLP 0095#13-per-subscription-states-and-the-version-guard — only a
// strictly newer durable version may mutate held subscription state.

export function durableVersionAdvances(currentVersion, nextVersion) {
  return typeof nextVersion !== 'number' || nextVersion > currentVersion;
}

export function applyLiveDeltaById(rows, operations) {
  const byId = new Map(
    (Array.isArray(rows) ? rows : []).map((row) => [row?._id, row]),
  );
  for (const operation of operations ?? []) {
    if (operation.op === 'remove') byId.delete(operation.id);
    else if (operation.op === 'add' || operation.op === 'update') {
      byId.set(operation.id, operation.row);
    }
  }
  return [...byId.values()];
}
