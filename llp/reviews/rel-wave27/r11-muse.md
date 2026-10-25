muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
agent loop failed: model failed: API error 429 [request_id=f1cb22c6-cdfc-4900-a352-6ba6dbee2e12]: Subscription quota exhausted. Your usage window resets at 2026-10-26T00:00:00Z. (rate_limit_error)
[muse-exec] plan quota exhausted; retrying with the Meta API key
muse: workspace root: /home/ccheever/projects/sb4-b27-rel (cwd default)
muse: workspace trust: trusted source=run-flag
MATERIAL — rollback resurrection of a deleted id can be masked by re-declaration.

Top finding: a row deleted in cycle 1 can reappear in cycle 2 `beforeV1Writes`/`older` and pass by re-declaring the same delete.

The loop persists `deletedByV1` but only asserts absence in `forward`. Pre-callback `compareMoves(current, beforeV1Writes, {required: oldRows filtered})` filters `deletedByV1`, so it does not forbid a resurrected deleted id. `beforeV1Writes.has(write.id)` then passes because it is visible, `!older.has(write.id)` passes after re-delete, and `!forward.has(id)` passes. The "remain absent on later cycles" clause is therefore unchecked for rollback snapshots, and cross-cycle duplicate is allowed. Single-cycle excuse prevention is correct.

Exact repair, inside the cycle after `beforeV1Writes`:

```js
for (const id of deletedByV1) assert.ok(!beforeV1Writes.has(id), `${id}: a deliberate v1 delete resurrected`);
```

In writes validation, refuse re-declaration:

```js
assert.ok(writes.every(write => !deletedByV1.has(write.id)), "already-deleted id re-declared");
```

After `older`, assert continued absence:

```js
for (const id of deletedByV1) assert.ok(!older.has(id), `${id}: deleted row present after v1 callback`);
```

No false refusal: in a correct run deleted ids stay absent everywhere, and a second declaration is already impossible via visibility.

