import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Journal, insist, readLines } from './common.mjs';
import { validateAction, actionDigest, resolveRefs } from './actions.mjs';

// @ref LLP 3000.009#101-the-brief — fixture actions travel through each application's own authenticated write path.
export async function replay(actions, adapter, receiptPath, { transportRetries = 2 } = {}) {
  const journal = await Journal.open(receiptPath), settled = new Map(), aliases = new Map();
  try {
    for (const record of journal.records) {
      insist(record.version === 1 && record.kind === 'replay.receipt', 'INVALID_RECEIPT_JOURNAL');
      settled.set(record.key, record);
      for (const [alias, id] of Object.entries(record.bindings ?? {})) aliases.set(alias, id);
    }
    let seq = 0, applied = 0, skipped = 0;
    const seen = new Set();
    for await (const action of actions) {
      validateAction(action, ++seq);
      insist(!seen.has(action.key), 'DUPLICATE_ACTION_KEY'); seen.add(action.key);
      const digest = actionDigest(action), previous = settled.get(action.key);
      if (previous) { insist(previous.digest === digest, 'REPLAY_INPUT_CHANGED'); skipped++; continue; }
      const input = resolveRefs(action.input, aliases);
      let result;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await adapter.execute(action, { input, actorId: aliases.get(action.actor), aliases: new Map(aliases) });
          break;
        } catch (error) {
          // Only explicitly unknown transport outcomes retry. Never mint a new action key.
          if (error.code !== 'TRANSPORT_UNKNOWN' || attempt >= transportRetries) throw error;
        }
      }
      insist(result && result.status === action.expect.status, 'UNEXPECTED_TERMINAL_OUTCOME');
      if (result.status === 'rejected') insist(result.reason === action.expect.reason, 'UNEXPECTED_REJECTION');
      if (action.expect.noChange) insist(result.noChange === true, 'NO_CHANGE_RECEIPT_REQUIRED');
      insist(typeof result.receipt?.id === 'string' && result.receipt.id.length > 0
        && result.receipt.authoritative === true, 'AUTHORITATIVE_RECEIPT_REQUIRED');
      const bindings = result.bindings ?? {};
      for (const [alias, id] of Object.entries(bindings)) {
        insist(alias === action.entity && typeof id === 'string' && id.length > 0, 'INVALID_BINDING');
        insist(!aliases.has(alias) || aliases.get(alias) === id, 'ALIAS_REBOUND');
      }
      if (action.entity && result.status === 'applied') insist(bindings[action.entity], 'ENTITY_BINDING_REQUIRED');
      const record = { version: 1, kind: 'replay.receipt', seq: action.seq, key: action.key, digest,
        status: result.status, reason: result.reason ?? null, receipt: result.receipt, bindings };
      await journal.append(record);
      settled.set(action.key, record);
      for (const [alias, id] of Object.entries(bindings)) aliases.set(alias, id);
      applied++;
    }
    return { applied, skipped, aliases: Object.fromEntries(aliases) };
  } finally { await journal.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [actionsPath, adapterPath, receiptsPath] = process.argv.slice(2);
  insist(actionsPath && adapterPath && receiptsPath, 'USAGE: node replay.mjs actions.ndjson adapter.mjs receipts.ndjson');
  const module = await import(pathToFileURL(resolve(adapterPath)).href);
  console.log(JSON.stringify(await replay(readLines(actionsPath), await module.createAdapter(), receiptsPath)));
}
