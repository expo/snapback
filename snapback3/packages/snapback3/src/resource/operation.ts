import { isSha256 } from '../../../evaluator/src/hash.js';
import { ownJson } from './signal.js';
import { SnapbackError, type Args, type StoredOperation } from './types.js';

export interface StoredOperationBody {
  op: string;
  args: Args;
  intent: string;
  planHash: string;
  schemaHash: string;
}

// @ref LLP 2000#durable-operation-ownership — restored work keeps one checked,
// immutable request identity and accepts only a matching terminal receipt.
export function checkedStoredOperation(entry: StoredOperation): StoredOperationBody {
  const body = JSON.parse(entry.body);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(entry.id) || typeof entry.principal !== 'string'
    || body.intent !== entry.id || typeof body.op !== 'string' || !body.op
    || !isSha256(body.planHash) || !isSha256(body.schemaHash) || !body.args || Array.isArray(body.args)
    || !['queued', 'parked', 'committed', 'rejected', 'conflict'].includes(entry.status)
    || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 0)
    throw new SnapbackError('S3_STORAGE', 'A pending operation has invalid identity.');
  if (entry.receipt && (entry.receipt.intent !== entry.id || entry.receipt.state !== entry.status
    || !['committed', 'rejected', 'conflict'].includes(entry.receipt.state)
    || !Number.isSafeInteger(entry.receipt.seq) || entry.receipt.seq < 0)
    || ['committed', 'rejected', 'conflict'].includes(entry.status) && !entry.receipt)
    throw new SnapbackError('S3_STORAGE', 'A saved operation has an invalid terminal receipt.');
  return ownJson(body);
}
