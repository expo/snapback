import {
  CANONICAL_PROFILE,
  HASH_DOMAINS,
  DocumentProtocolError,
  canonicalJson,
  compareUtf8,
  hashCanonical,
} from './canonical.mjs';

const SCHEMA_VERSION = 1;
const ROOT = null;
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'checklist-item',
  'quote',
  'code',
  'image',
]);
const TEXT_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'checklist-item',
  'quote',
  'code',
]);
const IDENTITY_KEYS = [
  'appId',
  'databaseId',
  'documentId',
  'streamIncarnation',
  'targetProfile',
];
const OPERATION_KEYS = [
  'authorizationWitness',
  'dependencies',
  'identity',
  'operationId',
  'payload',
  'schemaVersion',
];
const MAX_INSERT_SCALARS = 4_096;

function fail(code, message, details = {}) {
  throw new DocumentProtocolError(code, message, details);
}

function assertClosedObject(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('SNAPBACK_DOCUMENT_SCHEMA_INVALID', `${path} must be an object`, { path });
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(
      'SNAPBACK_DOCUMENT_SCHEMA_INVALID',
      `${path} has missing or unknown fields`,
      { path, actual, expected },
    );
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('SNAPBACK_DOCUMENT_SCHEMA_INVALID', `${path} must be a non-empty string`, { path });
  }
  canonicalJson(value);
  return value;
}

function assertSafeCounter(value, path, { allowZero = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maximum) {
    fail('SNAPBACK_DOCUMENT_COUNTER_INVALID', `${path} is outside its exact integer domain`, {
      path,
      value,
      maximum,
    });
  }
  return value;
}

function normalizeIdentity(value) {
  assertClosedObject(value, IDENTITY_KEYS, 'identity');
  return Object.fromEntries(
    IDENTITY_KEYS.map((key) => [key, assertNonEmptyString(value[key], `identity.${key}`)]),
  );
}

function normalizeOperationId(value, path = 'operationId') {
  if (!Array.isArray(value) || value.length !== 2) {
    fail('SNAPBACK_DOCUMENT_OPERATION_ID_INVALID', `${path} must be [authorityInstanceId, counter]`, {
      path,
    });
  }
  return [
    assertNonEmptyString(value[0], `${path}[0]`),
    assertSafeCounter(value[1], `${path}[1]`),
  ];
}

function normalizeAtomId(value, path) {
  if (!Array.isArray(value) || value.length !== 2) {
    fail('SNAPBACK_DOCUMENT_ATOM_ID_INVALID', `${path} must be [operationId, scalarOffset]`, {
      path,
    });
  }
  return [
    normalizeOperationId(value[0], `${path}[0]`),
    assertSafeCounter(value[1], `${path}[1]`, { allowZero: true, maximum: 0xffff_ffff }),
  ];
}

function compareOperationIds(left, right) {
  const authorityOrder = compareUtf8(left[0], right[0]);
  return authorityOrder === 0 ? left[1] - right[1] : authorityOrder;
}

function compareAtomIds(left, right) {
  return compareOperationIds(left[0], right[0]) || left[1] - right[1];
}

function operationKey(operationId) {
  return canonicalJson(operationId);
}

function atomKey(atomId) {
  return canonicalJson(atomId);
}

function normalizeDependencies(value, operationId) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('SNAPBACK_DOCUMENT_DEPENDENCIES_INVALID', 'dependencies must be an object', {});
  }
  const entries = [];
  for (const authority of Object.keys(value).sort(compareUtf8)) {
    assertNonEmptyString(authority, 'dependencies authority');
    const counter = assertSafeCounter(value[authority], `dependencies.${authority}`);
    entries.push([authority, counter]);
  }
  const normalized = Object.fromEntries(entries);
  const [authority, counter] = operationId;
  const ownDependency = normalized[authority] ?? 0;
  if (ownDependency !== counter - 1) {
    fail(
      'SNAPBACK_DOCUMENT_COUNTER_PREDECESSOR_INVALID',
      'an operation must depend on the immediately preceding counter from its authority',
      { operationId, expected: counter - 1, actual: ownDependency },
    );
  }
  return normalized;
}

function normalizeAttributes(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('SNAPBACK_DOCUMENT_SCHEMA_INVALID', `${path} must be an object`, { path });
  }
  canonicalJson(value);
  return value;
}

function assertAllowedKeys(value, required, optional, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('SNAPBACK_DOCUMENT_SCHEMA_INVALID', `${path} must be an object`, { path });
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('SNAPBACK_DOCUMENT_SCHEMA_INVALID', `${path}.${key} is not recognized`, { path, key });
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail('SNAPBACK_DOCUMENT_SCHEMA_INVALID', `${path}.${key} is required`, { path, key });
    }
  }
}

function normalizePayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('SNAPBACK_DOCUMENT_SCHEMA_INVALID', 'payload must be an object', {});
  }
  const kind = assertNonEmptyString(payload.kind, 'payload.kind');
  switch (kind) {
    case 'block.insert': {
      assertAllowedKeys(
        payload,
        ['kind', 'blockId', 'leftBlockId', 'blockType', 'attributes'],
        [],
        'payload',
      );
      const blockType = assertNonEmptyString(payload.blockType, 'payload.blockType');
      if (!BLOCK_TYPES.has(blockType)) {
        fail('SNAPBACK_DOCUMENT_BLOCK_TYPE_UNSUPPORTED', 'the block type is not in the v1 set', {
          blockType,
        });
      }
      return {
        kind,
        blockId: assertNonEmptyString(payload.blockId, 'payload.blockId'),
        leftBlockId: payload.leftBlockId === null
          ? null
          : assertNonEmptyString(payload.leftBlockId, 'payload.leftBlockId'),
        blockType,
        attributes: normalizeAttributes(payload.attributes, 'payload.attributes'),
      };
    }
    case 'block.delete':
      assertClosedObject(payload, ['kind', 'blockId'], 'payload');
      return { kind, blockId: assertNonEmptyString(payload.blockId, 'payload.blockId') };
    case 'block.move':
      assertClosedObject(payload, ['kind', 'blockId', 'leftBlockId'], 'payload');
      return {
        kind,
        blockId: assertNonEmptyString(payload.blockId, 'payload.blockId'),
        leftBlockId: payload.leftBlockId === null
          ? null
          : assertNonEmptyString(payload.leftBlockId, 'payload.leftBlockId'),
      };
    case 'block.attribute':
      assertClosedObject(payload, ['kind', 'blockId', 'name', 'value'], 'payload');
      canonicalJson(payload.value);
      return {
        kind,
        blockId: assertNonEmptyString(payload.blockId, 'payload.blockId'),
        name: assertNonEmptyString(payload.name, 'payload.name'),
        value: payload.value,
      };
    case 'text.insert': {
      assertClosedObject(payload, ['kind', 'blockId', 'leftAtomId', 'scalars'], 'payload');
      if (!Array.isArray(payload.scalars)
        || payload.scalars.length === 0
        || payload.scalars.length > MAX_INSERT_SCALARS) {
        fail(
          'SNAPBACK_DOCUMENT_TEXT_INSERT_LIMIT',
          `text.insert must carry 1–${MAX_INSERT_SCALARS} Unicode scalars`,
          { count: Array.isArray(payload.scalars) ? payload.scalars.length : null },
        );
      }
      const scalars = payload.scalars.map((scalar, index) => {
        if (typeof scalar !== 'string' || Array.from(scalar).length !== 1) {
          fail(
            'SNAPBACK_DOCUMENT_TEXT_SCALAR_INVALID',
            'each text insertion member must contain exactly one Unicode scalar',
            { index },
          );
        }
        const codePoint = scalar.codePointAt(0);
        if ((codePoint >= 0xfdd0 && codePoint <= 0xfdef)
          || (codePoint & 0xffff) === 0xfffe
          || (codePoint & 0xffff) === 0xffff) {
          fail(
            'SNAPBACK_DOCUMENT_TEXT_SCALAR_INVALID',
            'the text scalar is a Unicode noncharacter',
            { index, codePoint },
          );
        }
        canonicalJson(scalar);
        return scalar;
      });
      return {
        kind,
        blockId: assertNonEmptyString(payload.blockId, 'payload.blockId'),
        leftAtomId: payload.leftAtomId === null
          ? null
          : normalizeAtomId(payload.leftAtomId, 'payload.leftAtomId'),
        scalars,
      };
    }
    case 'text.delete':
      assertClosedObject(payload, ['kind', 'blockId', 'atomIds'], 'payload');
      if (!Array.isArray(payload.atomIds) || payload.atomIds.length === 0) {
        fail('SNAPBACK_DOCUMENT_TEXT_DELETE_INVALID', 'text.delete requires atom ids', {});
      }
      return {
        kind,
        blockId: assertNonEmptyString(payload.blockId, 'payload.blockId'),
        atomIds: payload.atomIds.map((id, index) => normalizeAtomId(id, `payload.atomIds[${index}]`)),
      };
    default:
      fail(
        'SNAPBACK_DOCUMENT_OPERATION_UNSUPPORTED',
        'the exploratory reducer does not implement this operation kind',
        { kind },
      );
  }
}

function normalizeOperation(value) {
  assertClosedObject(value, OPERATION_KEYS, 'operation');
  if (value.schemaVersion !== SCHEMA_VERSION) {
    fail('SNAPBACK_DOCUMENT_SCHEMA_VERSION_UNSUPPORTED', 'operation schema version is unsupported', {
      schemaVersion: value.schemaVersion,
    });
  }
  const operationId = normalizeOperationId(value.operationId);
  const operation = {
    schemaVersion: SCHEMA_VERSION,
    identity: normalizeIdentity(value.identity),
    authorizationWitness: assertNonEmptyString(
      value.authorizationWitness,
      'authorizationWitness',
    ),
    operationId,
    dependencies: normalizeDependencies(value.dependencies, operationId),
    payload: normalizePayload(value.payload),
  };
  canonicalJson(operation);
  return operation;
}

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function dependenciesReady(dependencies, frontier) {
  return Object.entries(dependencies).every(
    ([authority, counter]) => (frontier.get(authority) ?? 0) >= counter,
  );
}

function operationObservedBy(operationId, dependencies) {
  return (dependencies[operationId[0]] ?? 0) >= operationId[1];
}

function requireBlock(state, blockId, operationId) {
  const block = state.blocks.get(blockId);
  if (block === undefined) {
    fail(
      'SNAPBACK_DOCUMENT_ANCHOR_UNKNOWN',
      'the operation references an unknown block identity',
      { blockId, operationId },
    );
  }
  return block;
}

function requireLeftBlock(state, leftBlockId, operationId) {
  if (leftBlockId !== ROOT) requireBlock(state, leftBlockId, operationId);
}

function requireAtom(state, blockId, id, operationId) {
  const atom = state.atoms.get(atomKey(id));
  if (atom === undefined || atom.blockId !== blockId) {
    fail(
      'SNAPBACK_DOCUMENT_ANCHOR_UNKNOWN',
      'the operation references an unknown atom identity in this block',
      { blockId, atomId: id, operationId },
    );
  }
  return atom;
}

function applyOperation(state, operation) {
  const { operationId, payload } = operation;
  switch (payload.kind) {
    case 'block.insert': {
      if (state.blocks.has(payload.blockId)) {
        fail(
          'SNAPBACK_DOCUMENT_BLOCK_ID_REUSED',
          'a block identity may be inserted only once',
          { blockId: payload.blockId, operationId },
        );
      }
      requireLeftBlock(state, payload.leftBlockId, operationId);
      const attributes = new Map(
        Object.entries(payload.attributes).map(([name, value]) => [
          name,
          { value, operationId },
        ]),
      );
      state.blocks.set(payload.blockId, {
        blockId: payload.blockId,
        blockType: payload.blockType,
        deleted: false,
        placements: [{
          leftBlockId: payload.leftBlockId,
          operationId,
          superseded: false,
        }],
        attributes,
      });
      break;
    }
    case 'block.delete':
      requireBlock(state, payload.blockId, operationId).deleted = true;
      break;
    case 'block.move': {
      const block = requireBlock(state, payload.blockId, operationId);
      requireLeftBlock(state, payload.leftBlockId, operationId);
      for (const placement of block.placements) {
        if (operationObservedBy(placement.operationId, operation.dependencies)) {
          placement.superseded = true;
        }
      }
      block.placements.push({
        leftBlockId: payload.leftBlockId,
        operationId,
        superseded: false,
      });
      break;
    }
    case 'block.attribute': {
      const block = requireBlock(state, payload.blockId, operationId);
      const prior = block.attributes.get(payload.name);
      if (prior === undefined || compareOperationIds(prior.operationId, operationId) < 0) {
        block.attributes.set(payload.name, { value: payload.value, operationId });
      }
      break;
    }
    case 'text.insert': {
      const block = requireBlock(state, payload.blockId, operationId);
      if (!TEXT_BLOCK_TYPES.has(block.blockType)) {
        fail(
          'SNAPBACK_DOCUMENT_BLOCK_TEXT_UNSUPPORTED',
          'text operations require a textual block',
          { blockId: payload.blockId, blockType: block.blockType },
        );
      }
      if (payload.leftAtomId !== null) {
        requireAtom(state, payload.blockId, payload.leftAtomId, operationId);
      }
      let leftAtomId = payload.leftAtomId;
      for (let offset = 0; offset < payload.scalars.length; offset += 1) {
        const id = [operationId, offset];
        const key = atomKey(id);
        if (state.atoms.has(key)) {
          fail(
            'SNAPBACK_DOCUMENT_ATOM_ID_REUSED',
            'a derived atom identity already exists',
            { atomId: id, operationId },
          );
        }
        state.atoms.set(key, {
          atomId: id,
          blockId: payload.blockId,
          leftAtomId,
          scalar: payload.scalars[offset],
          deleted: false,
        });
        leftAtomId = id;
      }
      break;
    }
    case 'text.delete':
      for (const id of payload.atomIds) {
        requireAtom(state, payload.blockId, id, operationId).deleted = true;
      }
      break;
    default:
      fail('SNAPBACK_DOCUMENT_OPERATION_UNSUPPORTED', 'operation kind is unsupported', {
        kind: payload.kind,
      });
  }
}

function greatestPlacement(block) {
  return block.placements.filter(({ superseded }) => !superseded).sort(
    (left, right) => compareOperationIds(right.operationId, left.operationId),
  )[0];
}

function resolveDeletedAnchor(blockId, blocks, placements) {
  let cursor = blockId;
  const visited = new Set();
  while (cursor !== ROOT) {
    if (visited.has(cursor)) return ROOT;
    visited.add(cursor);
    const block = blocks.get(cursor);
    if (block === undefined) return ROOT;
    if (!block.deleted) return cursor;
    cursor = placements.get(cursor)?.leftBlockId ?? ROOT;
  }
  return ROOT;
}

function findCycle(predecessors) {
  const complete = new Set();
  for (const start of predecessors.keys()) {
    if (complete.has(start)) continue;
    const path = [];
    const positions = new Map();
    let cursor = start;
    while (cursor !== ROOT && predecessors.has(cursor) && !complete.has(cursor)) {
      if (positions.has(cursor)) return path.slice(positions.get(cursor));
      positions.set(cursor, path.length);
      path.push(cursor);
      cursor = predecessors.get(cursor);
    }
    for (const blockId of path) complete.add(blockId);
  }
  return null;
}

// @ref LLP 0068#blocks — causally observed placement tombstones,
// greatest-concurrent-placement cycle breaking, and deleted-anchor resolution
// make block order a function of the operation set rather than delivery order.
function materializeBlockOrder(state) {
  const placements = new Map(
    [...state.blocks.entries()].map(([blockId, block]) => [blockId, greatestPlacement(block)]),
  );
  const live = new Map([...state.blocks].filter(([, block]) => !block.deleted));
  const predecessors = new Map();
  for (const [blockId] of live) {
    const placement = placements.get(blockId);
    predecessors.set(
      blockId,
      resolveDeletedAnchor(placement.leftBlockId, state.blocks, placements),
    );
  }
  for (;;) {
    const cycle = findCycle(predecessors);
    if (cycle === null) break;
    const cut = [...cycle].sort((left, right) => (
      compareOperationIds(
        placements.get(right).operationId,
        placements.get(left).operationId,
      )
    ))[0];
    predecessors.set(cut, ROOT);
  }

  const children = new Map();
  for (const [blockId, predecessor] of predecessors) {
    const siblings = children.get(predecessor) ?? [];
    siblings.push(blockId);
    children.set(predecessor, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => compareOperationIds(
      placements.get(left).operationId,
      placements.get(right).operationId,
    ));
  }
  const ordered = [];
  const visit = (predecessor) => {
    for (const child of children.get(predecessor) ?? []) {
      ordered.push(child);
      visit(child);
    }
  };
  visit(ROOT);
  return ordered;
}

// @ref LLP 0068#text-and-marks — atom identities derive from operation plus
// scalar offset; tombstones remain traversal anchors while visible text omits
// them. Marks intentionally remain outside this exploratory subset.
function materializeText(state, blockId) {
  const atoms = [...state.atoms.values()].filter((atom) => atom.blockId === blockId);
  const children = new Map();
  for (const atom of atoms) {
    const predecessor = atom.leftAtomId === ROOT ? ROOT : atomKey(atom.leftAtomId);
    const siblings = children.get(predecessor) ?? [];
    siblings.push(atom);
    children.set(predecessor, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => compareAtomIds(left.atomId, right.atomId));
  }
  const visible = [];
  const visit = (predecessor) => {
    for (const atom of children.get(predecessor) ?? []) {
      if (!atom.deleted) visible.push(atom);
      visit(atomKey(atom.atomId));
    }
  };
  visit(ROOT);
  return {
    text: visible.map(({ scalar }) => scalar).join(''),
    visibleAtomIds: visible.map(({ atomId }) => atomId),
  };
}

function materializeSnapshot(state, identity) {
  const frontier = Object.fromEntries(
    [...state.frontier.entries()].sort(([left], [right]) => compareUtf8(left, right)),
  );
  const blocks = materializeBlockOrder(state).map((blockId) => {
    const block = state.blocks.get(blockId);
    const attributes = Object.fromEntries(
      [...block.attributes.entries()]
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([name, register]) => [name, register.value]),
    );
    const text = TEXT_BLOCK_TYPES.has(block.blockType)
      ? materializeText(state, blockId)
      : { text: '', visibleAtomIds: [] };
    return {
      blockId,
      blockType: block.blockType,
      attributes,
      text: text.text,
      visibleAtomIds: text.visibleAtomIds,
    };
  });
  return {
    profile: CANONICAL_PROFILE,
    schemaVersion: SCHEMA_VERSION,
    identity,
    frontier,
    blocks,
  };
}

// @ref LLP 0068#canonical-reduction — normalize and deduplicate first, buffer
// missing dependencies, then apply ready operations in tuple-byte order.
export function reduceDocument(deliveries) {
  if (!Array.isArray(deliveries) || deliveries.length === 0) {
    fail('SNAPBACK_DOCUMENT_BATCH_INVALID', 'deliveries must be a non-empty array', {});
  }
  let identity = null;
  const operations = new Map();
  for (const delivery of deliveries) {
    const operation = normalizeOperation(delivery);
    if (identity === null) identity = operation.identity;
    if (!sameIdentity(identity, operation.identity)) {
      fail(
        'SNAPBACK_DOCUMENT_IDENTITY_MISMATCH',
        'an operation belongs to another application/database/target/stream/document tuple',
        { expected: identity, actual: operation.identity },
      );
    }
    const key = operationKey(operation.operationId);
    const operationHash = hashCanonical(HASH_DOMAINS.operation, operation);
    const prior = operations.get(key);
    if (prior !== undefined && prior.operationHash !== operationHash) {
      fail(
        'SNAPBACK_DOCUMENT_OPERATION_ID_REUSED',
        'one operation id was delivered with different canonical bytes',
        { operationId: operation.operationId, expectedHash: prior.operationHash, actualHash: operationHash },
      );
    }
    if (prior === undefined) operations.set(key, { operation, operationHash });
  }

  const state = {
    blocks: new Map(),
    atoms: new Map(),
    frontier: new Map(),
    applied: new Set(),
  };
  for (;;) {
    const ready = [...operations.entries()]
      .filter(([key, { operation }]) => (
        !state.applied.has(key) && dependenciesReady(operation.dependencies, state.frontier)
      ))
      .sort(([, left], [, right]) => compareOperationIds(
        left.operation.operationId,
        right.operation.operationId,
      ));
    if (ready.length === 0) break;
    for (const [key, { operation }] of ready) {
      const [authority, counter] = operation.operationId;
      if ((state.frontier.get(authority) ?? 0) + 1 !== counter) continue;
      applyOperation(state, operation);
      state.frontier.set(authority, counter);
      state.applied.add(key);
    }
  }

  const snapshot = materializeSnapshot(state, identity);
  const pendingOperationIds = [...operations.entries()]
    .filter(([key]) => !state.applied.has(key))
    .map(([, { operation }]) => operation.operationId)
    .sort(compareOperationIds);
  const appliedOperationIds = [...state.applied]
    .map((key) => operations.get(key).operation.operationId)
    .sort(compareOperationIds);
  return {
    snapshot,
    snapshotCanonicalJson: canonicalJson(snapshot),
    snapshotHash: hashCanonical(HASH_DOMAINS.snapshot, snapshot),
    frontierHash: hashCanonical(HASH_DOMAINS.frontier, snapshot.frontier),
    appliedOperationIds,
    pendingOperationIds,
  };
}

export { DocumentProtocolError, canonicalJson, hashCanonical, HASH_DOMAINS };
