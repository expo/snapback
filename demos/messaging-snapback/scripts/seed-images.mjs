#!/usr/bin/env node
// Idempotently drops two real photos into the seed backlog through the
// ordinary upload -> finalize -> attach path (not a raw row insert), so the
// demo starts with image messages that went through the actual asset
// pipeline. Safe to call on every dev-server boot: it checks for an
// already-attached image before uploading anything.
//
// Uses the `snapback assets put` CLI rather than the plain HTTP asset
// client: dev-mode HTTP asset requests resolve the caller as anonymous
// (no identity carried on that surface — see guide/backend/assets.md), and
// this app's messageImageUpload intent records a specific per-handle owner,
// so every later TUS/finalize step 403s unless the caller is a real
// identity. The CLI's `--user` flag drives asset.put through the admin
// host-ops path, which *does* carry an explicit user identity end to end.
// See issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { makeSolidPng } from './make-png.mjs';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const repoRoot = resolve(appDir, '..', '..');

async function putImage({ binary, origin, adminToken, authorHandle, rgb, filename }) {
  const dir = mkdtempSync(join(tmpdir(), 'messaging-seed-'));
  const filePath = join(dir, filename);
  try {
    writeFileSync(filePath, makeSolidPng(24, 24, rgb));
    const { stdout } = await execFileAsync(binary, [
      'assets', 'put', filePath,
      '--upload', 'messageImageUpload',
      '--user', authorHandle,
      '--url', origin,
      '--token', adminToken,
      '--content-type', 'image/png',
    ]);
    const envelope = JSON.parse(stdout);
    if (!envelope.ok || envelope.data?.task?.availability !== 'ready') {
      throw new Error(`asset.put did not finalize ready: ${stdout}`);
    }
    return envelope.data.task.assetId;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function seedImages(origin, { binary, adminToken } = {}) {
  const resolvedBinary = binary ?? process.env.SNAPBACK_SERVER_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback');
  const resolvedAdminToken = adminToken ?? process.env.SNAPBACK_ADMIN_TOKEN;
  if (!resolvedAdminToken) throw new Error('seedImages requires an admin token (SNAPBACK_ADMIN_TOKEN or the adminToken option)');

  const generatedDir = join(appDir, 'snapback', 'generated');
  const api = (await import(`file://${join(generatedDir, 'api.mjs')}`)).default;
  const { SnapbackClient } = await import(`file://${join(repoRoot, 'packages', 'snapback-client', 'index.mjs')}`);
  const client = new SnapbackClient(origin, { rqsStore: null });

  try {
    const founders = await client.query(api.conversationMessages, {
      args: { conversationId: 'conv_group_founders' },
    });
    const alreadySeeded = founders.rows.some((row) => row.image !== undefined && row.image !== null);
    if (alreadySeeded) {
      console.log('[messaging] seed images already present, skipping');
      return;
    }

    const founderPhoto = await putImage({
      binary: resolvedBinary,
      origin,
      adminToken: resolvedAdminToken,
      authorHandle: 'mo',
      rgb: [56, 189, 122],
      filename: 'ship-it.png',
    });
    await client.mutate(api.sendMessage, {
      args: {
        conversationId: 'conv_group_founders',
        authorHandle: 'mo',
        authorName: 'Mo Farah',
        body: 'the release banner I made 🎨',
        assetId: founderPhoto,
      },
      // ctx.assets.attach() requires a caller principal matching the asset's
      // owner (recorded as ctx.auth.userId at upload time under --user mo).
      userId: 'mo',
    });

    const tripPhoto = await putImage({
      binary: resolvedBinary,
      origin,
      adminToken: resolvedAdminToken,
      authorHandle: 'priya',
      rgb: [37, 99, 235],
      filename: 'cabin-view.png',
    });
    await client.mutate(api.sendMessage, {
      args: {
        conversationId: 'conv_group_trip',
        authorHandle: 'priya',
        authorName: 'Priya Rao',
        body: 'the view from the cabin deck 🏔️',
        assetId: tripPhoto,
      },
      userId: 'priya',
    });

    console.log('[messaging] seeded 2 image messages');
  } finally {
    await client.closeAuth();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const origin = process.argv[2] ?? process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4421';
  await seedImages(origin);
}
