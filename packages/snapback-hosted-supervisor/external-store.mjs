// @ref LLP 0105#one-fail-closed-hosted-authority-and-recoverable-supervisor —
// every canonical SQLite generation is mirrored immutably before an
// If-Match update advances the external incarnation anchor.

import {
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { canonicalJson, SupervisorRefusal, sha256 } from './index.mjs';

const MIRROR_VERSION = 'snapback.hosted-supervisor-mirror.v1';
const ANCHOR_VERSION = 'snapback.hosted-supervisor-incarnation-anchor.v1';
const MAX_CHAIN_LENGTH = 10_000;

function parseS3Url(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_INSTALLATION_INVALID',
      `${label} is not an exact S3 object`,
    );
  }
  if (url.protocol !== 's3:' || !url.hostname || url.pathname.length < 2) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_INSTALLATION_INVALID',
      `${label} is not an exact S3 object`,
    );
  }
  return { bucket: url.hostname, key: url.pathname.slice(1) };
}

async function objectBytes(client, bucket, key) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return {
    bytes: Buffer.from(await result.Body.transformToByteArray()),
    etag: result.ETag ?? null,
  };
}

async function putImmutable(client, bucket, key, bytes) {
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
  } catch (error) {
    // An interrupted retry may encounter the already-created immutable
    // object. Only byte-identical read-back makes that replay successful.
    if (error?.$metadata?.httpStatusCode !== 412 && error?.name !== 'PreconditionFailed') throw error;
  }
  const retained = await objectBytes(client, bucket, key);
  if (!retained.bytes.equals(bytes)) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_IMMUTABLE_OBJECT_COLLISION',
      `immutable external object ${key} changed bytes`,
    );
  }
}

function requireIdentity(value, installationReceipt, label) {
  if (
    value?.installationId !== installationReceipt.installationId
    || value?.incarnation !== installationReceipt.incarnation
    || !Number.isSafeInteger(value?.generation)
    || value.generation < 0
  ) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_EXTERNAL_AUTHORITY_MISMATCH',
      `${label} does not match the installed supervisor identity`,
    );
  }
}

function mirrorDocument(installationReceipt, database) {
  return {
    schemaVersion: MIRROR_VERSION,
    installationId: installationReceipt.installationId,
    incarnation: installationReceipt.incarnation,
    generation: database.generation,
    journalDigest: sha256(Buffer.from(canonicalJson(database.journal))),
    controlHeadDigest: sha256(Buffer.from(canonicalJson(database.heads))),
    database,
  };
}

function anchorKey(generation, digest) {
  return `snapback-supervisor/anchor/generation-${String(generation).padStart(12, '0')}-${digest.slice('sha256:'.length)}.json`;
}

function mirrorKey(generation, digest) {
  return `snapback-supervisor/journal/generation-${String(generation).padStart(12, '0')}-${digest.slice('sha256:'.length)}.json`;
}

function anchorDocument({
  installationReceipt,
  database,
  mirrorSha256,
  retainedMirrorKey,
  rootAnchorSha256,
  previousAnchorSha256,
  previousAnchorKey,
}) {
  return {
    schemaVersion: ANCHOR_VERSION,
    installationId: installationReceipt.installationId,
    ownershipSentinel: installationReceipt.ownershipSentinel,
    incarnation: installationReceipt.incarnation,
    generation: database.generation,
    mirrorKey: retainedMirrorKey,
    mirrorSha256,
    journalDigest: sha256(Buffer.from(canonicalJson(database.journal))),
    spendFloor: database.floors.spend,
    cleanupFloor: database.floors.cleanup,
    replayFloor: database.floors.replay,
    controlHeadDigest: sha256(Buffer.from(canonicalJson(database.heads))),
    rootAnchorSha256,
    previousAnchorSha256,
    previousAnchorKey,
  };
}

/**
 * Read and verify the current pointer, its immutable mirror, and the complete
 * predecessor anchor chain back to the installation receipt's generation-0
 * authorization root.
 */
export async function readExternalAuthority({
  installationReceipt,
  anchorClient,
  journalClient,
}) {
  const location = parseS3Url(installationReceipt.externalAnchor, 'external anchor');
  const pointer = await objectBytes(anchorClient, location.bucket, location.key);
  const pointerSha256 = sha256(pointer.bytes);
  const anchor = JSON.parse(pointer.bytes.toString('utf8'));
  requireIdentity(anchor, installationReceipt, 'external anchor');
  if (anchor.schemaVersion !== ANCHOR_VERSION) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_EXTERNAL_AUTHORITY_MISMATCH',
      'external anchor version is unsupported',
    );
  }

  if (anchor.generation === 0) {
    if (pointerSha256 !== installationReceipt.externalAnchorSha256) {
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_EXTERNAL_AUTHORITY_MISMATCH',
        'generation-0 anchor does not match the standing authorization root',
      );
    }
  } else {
    if (anchor.rootAnchorSha256 !== installationReceipt.externalAnchorSha256) {
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_EXTERNAL_AUTHORITY_MISMATCH',
        'external anchor chain names a different standing authorization root',
      );
    }
    let current = anchor;
    let currentBytes = pointer.bytes;
    let currentSha256 = pointerSha256;
    for (let depth = 0; current.generation > 0; depth += 1) {
      if (depth >= MAX_CHAIN_LENGTH || !current.previousAnchorKey || !current.previousAnchorSha256) {
        throw new SupervisorRefusal(
          'SNAPBACK_SUPERVISOR_EXTERNAL_CHAIN_INVALID',
          'external anchor predecessor chain is incomplete or exceeds its bound',
        );
      }
      const immutableCurrentKey = anchorKey(current.generation, currentSha256);
      const immutableCurrent = await objectBytes(anchorClient, location.bucket, immutableCurrentKey);
      if (!immutableCurrent.bytes.equals(currentBytes)) {
        throw new SupervisorRefusal(
          'SNAPBACK_SUPERVISOR_EXTERNAL_CHAIN_INVALID',
          'current anchor is not retained immutably',
        );
      }
      const predecessor = await objectBytes(
        anchorClient,
        location.bucket,
        current.previousAnchorKey,
      );
      const predecessorSha256 = sha256(predecessor.bytes);
      if (predecessorSha256 !== current.previousAnchorSha256) {
        throw new SupervisorRefusal(
          'SNAPBACK_SUPERVISOR_EXTERNAL_CHAIN_INVALID',
          'external predecessor anchor digest does not match',
        );
      }
      const parsed = JSON.parse(predecessor.bytes.toString('utf8'));
      requireIdentity(parsed, installationReceipt, 'predecessor anchor');
      if (parsed.generation !== current.generation - 1) {
        throw new SupervisorRefusal(
          'SNAPBACK_SUPERVISOR_EXTERNAL_CHAIN_INVALID',
          'external predecessor generation is not contiguous',
        );
      }
      current = parsed;
      currentBytes = predecessor.bytes;
      currentSha256 = predecessorSha256;
    }
    if (
      currentSha256 !== installationReceipt.externalAnchorSha256
      || anchor.rootAnchorSha256 !== installationReceipt.externalAnchorSha256
    ) {
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_EXTERNAL_CHAIN_INVALID',
        'external anchor chain does not terminate at the installation root',
      );
    }
  }

  const mirror = await objectBytes(journalClient, location.bucket, anchor.mirrorKey);
  if (sha256(mirror.bytes) !== anchor.mirrorSha256) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_EXTERNAL_AUTHORITY_MISMATCH',
      'external mirror digest does not match its anchor',
    );
  }
  const mirrorValue = JSON.parse(mirror.bytes.toString('utf8'));
  requireIdentity(mirrorValue, installationReceipt, 'external mirror');
  if (
    mirrorValue.schemaVersion !== MIRROR_VERSION
    || mirrorValue.generation !== anchor.generation
    || mirrorValue.journalDigest !== anchor.journalDigest
    || mirrorValue.controlHeadDigest !== anchor.controlHeadDigest
  ) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_EXTERNAL_AUTHORITY_MISMATCH',
      'external mirror and anchor disagree',
    );
  }
  return {
    anchor,
    anchorBytes: pointer.bytes,
    anchorEtag: pointer.etag,
    anchorSha256: pointerSha256,
    mirror: mirrorValue,
    mirrorSha256: anchor.mirrorSha256,
  };
}

/**
 * Publish exactly one locally committed generation. The caller must persist
 * SQLite first. Immutable mirror and anchor records precede the conditional
 * current-pointer write.
 */
export async function publishExternalAuthority({
  installationReceipt,
  anchorClient,
  journalClient,
  previous,
  database,
}) {
  if (database.generation !== previous.anchor.generation + 1) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_EXTERNAL_GENERATION_INVALID',
      'external publication must advance exactly one generation',
    );
  }
  const location = parseS3Url(installationReceipt.externalAnchor, 'external anchor');
  const mirror = mirrorDocument(installationReceipt, database);
  const mirrorBytes = Buffer.from(canonicalJson(mirror));
  const mirrorSha256 = sha256(mirrorBytes);
  const retainedMirrorKey = mirrorKey(database.generation, mirrorSha256);
  await putImmutable(journalClient, location.bucket, retainedMirrorKey, mirrorBytes);

  const previousAnchorKey = anchorKey(previous.anchor.generation, previous.anchorSha256);
  await putImmutable(
    anchorClient,
    location.bucket,
    previousAnchorKey,
    previous.anchorBytes,
  );
  const anchor = anchorDocument({
    installationReceipt,
    database,
    mirrorSha256,
    retainedMirrorKey,
    rootAnchorSha256: installationReceipt.externalAnchorSha256,
    previousAnchorSha256: previous.anchorSha256,
    previousAnchorKey,
  });
  const anchorBytes = Buffer.from(canonicalJson(anchor));
  const anchorSha256 = sha256(anchorBytes);
  await putImmutable(
    anchorClient,
    location.bucket,
    anchorKey(database.generation, anchorSha256),
    anchorBytes,
  );
  if (!previous.anchorEtag) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_EXTERNAL_CAS_UNAVAILABLE',
      'external anchor did not supply a conditional-write identity',
    );
  }
  try {
    await anchorClient.send(new PutObjectCommand({
      Bucket: location.bucket,
      Key: location.key,
      Body: anchorBytes,
      ContentType: 'application/json',
      IfMatch: previous.anchorEtag,
    }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 412 || error?.name === 'PreconditionFailed') {
      throw new SupervisorRefusal(
        'SNAPBACK_SUPERVISOR_ANCHOR_CAS_FAILED',
        'external incarnation anchor changed before publication',
      );
    }
    throw error;
  }
  const current = await readExternalAuthority({
    installationReceipt,
    anchorClient,
    journalClient,
  });
  if (current.anchorSha256 !== anchorSha256) {
    throw new SupervisorRefusal(
      'SNAPBACK_SUPERVISOR_EXTERNAL_READBACK_FAILED',
      'external anchor read-back did not match the committed generation',
    );
  }
  return current;
}

export function coreStateFromExternal(installationReceipt, external) {
  return {
    installationReceipt,
    incarnation: installationReceipt.incarnation,
    database: structuredClone(external.mirror.database),
    mirror: {
      generation: external.mirror.generation,
      database: structuredClone(external.mirror.database),
      journalDigest: external.mirror.journalDigest,
    },
    anchor: {
      incarnation: installationReceipt.incarnation,
      generation: external.anchor.generation,
      journalDigest: external.anchor.journalDigest,
      spendFloor: external.anchor.spendFloor,
      cleanupFloor: external.anchor.cleanupFloor,
      replayFloor: external.anchor.replayFloor,
      controlHeadDigest: external.anchor.controlHeadDigest,
    },
  };
}
