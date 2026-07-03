// Graffiti wall — Contract surface bootstrap (web host).
//
// The paved path all the way through: the durable wall reaches the .contract as
// a board-scoped live `query` binding (listCells over the shared stream — the
// liveQueries `{ name, args }` entry), remote painters arrive through the
// generated `ephemeral` binding, and this tab's pointer leaves through the
// authored rated `publish` line declared IN graffiti.contract. No hand-written
// poll pump, no pointer listener, no publish throttle here — this file is pure
// bootstrap: identity, provisioning, surface creation, mount.
//
// Boot is D4-shaped (LLP 0034 §5 / ENG-22527): one idempotent ensureApp that
// inspects first, provisions only what is missing, and seeds only when the
// wall is empty — a second tab's boot can never clear the first tab's presence
// rooms (the loadSchema-wipes-rooms footgun this demo's diary recorded).

import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import { BOARD_ID, randomPainter } from './board.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import app from './graffiti.contract';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';

let activeSurface: { dispose?: () => void } | null = null;

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  const origin = (globalThis as { __exactServerOrigin?: string }).__exactServerOrigin;
  return typeof origin === 'string' && origin.length > 0 ? `${origin}/snapback` : '/snapback';
}

function ensureBootStatusElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById('boot-status');
  if (existing) return existing;

  const style = document.createElement('style');
  style.textContent = `
    #boot-status {
      position: fixed; left: 16px; bottom: 16px;
      max-width: min(520px, calc(100vw - 32px));
      padding: 10px 12px; border: 1px solid #d7dce2; border-radius: 6px;
      background: #ffffff; color: #2a3038;
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
    }
    #boot-status[data-state="ready"] { display: none; }
    #boot-status[data-state="error"] { border-color: #e2a1a1; color: #8a1f1f; }
  `;
  document.head.append(style);

  const el = document.createElement('div');
  el.id = 'boot-status';
  document.body.append(el);
  return el;
}

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  if (typeof document === 'undefined') {
    console.log(`[snapback-graffiti] ${message}`);
    return;
  }
  const el = ensureBootStatusElement();
  if (!el) return;
  el.textContent = message;
  el.dataset.state = state;
}

function showIdentity(name: string, color: string): void {
  if (typeof document === 'undefined') return;
  // The Contract web host owns #exact-root and clears stray body nodes, so build
  // the identity chip fresh here (like the boot-status element) rather than
  // relying on one declared in index.html.
  let chip = document.getElementById('identity-chip');
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'identity-chip';
    document.body.append(chip);
  }
  chip.style.cssText =
    'position:fixed;right:16px;top:16px;display:flex;align-items:center;gap:8px;padding:6px 12px;' +
    'border:1px solid #e4e4e9;border-radius:999px;background:#fff;color:#1c1d21;z-index:50;' +
    'font:13px/1.2 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 6px 16px rgba(15,23,42,0.06);';
  chip.innerHTML = '';
  const dot = document.createElement('span');
  dot.style.cssText = `width:12px;height:12px;border-radius:999px;background:${color};display:inline-block;border:2px solid #fff;box-shadow:0 0 0 1px #00000022;`;
  const label = document.createElement('span');
  label.textContent = `You are ${name}`;
  chip.append(dot, label);
}

async function boot(): Promise<void> {
  status('Connecting to Snapback…');
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();

  // Single idempotent mount-lifecycle ensure (LLP 0034 §5): provisions only
  // what is missing, seeds only when the cells table is empty, never resets —
  // so opening a second tab neither wipes the wall nor the presence rooms.
  status('Ensuring backend provisioning…');
  await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });

  const identity = randomPainter();

  status('Subscribing to the live wall…');
  const surface = await createSnapbackContractSurface({
    runtime: await import('@exact/contract/runtime'),
    client,
    userId: identity.userId,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
    // The board-scoped live query binds with its args over the shared stream.
    liveQueries: [{ name: 'listCells', args: { boardId: BOARD_ID } }],
    // SECURITY — DEMO ONLY, DO NOT COPY THIS AUTH PATTERN INTO A REAL APP.
    // boardCursors publish/subscribe require the board's `boardMember` room
    // permission (schema.mjs enforces it server-side via
    // `allow.roomPermission('boardMember')`). Here the *client* mints that
    // permission and sends it with every request, and the local dev server
    // trusts it — because this demo declares `external_auth` as a capability gap
    // (see demo.snapback.json `capabilityGaps`): there is no auth provider to
    // decide membership, so the client stands in for one. That is an auth check
    // in the wrong place. In a real app a trusted server-side external_auth
    // provider must decide board membership and mint this permission; a client
    // must NEVER assert its own room membership (a copy-paster who keeps this
    // line ships an app where anyone can join any room). Only the trusted
    // *minting* is stubbed here — the server-side *enforcement* point is real.
    ephemeralPermissions: (_name: string, scope: Record<string, unknown>) => [
      SnapbackClient.roomPermission('boardMember', scope),
    ],
  });
  activeSurface = surface;
  // Subscribe the board room before mount so the binding's first snapshot is ready.
  await surface.prewarmEphemeral('boardCursors', { boardId: BOARD_ID });
  configureSnapbackContractLinks(surface.links as never);

  status('Mounting the wall…');
  installContractWebHost();
  mount(app, { props: { painterName: identity.name, painterColor: identity.color } });
  // After mount so the Contract web host's body handling doesn't clear the chip.
  showIdentity(identity.name, identity.color);
  status('Ready', 'ready');

  // Test/debug facts for browser acceptance and agents.
  (globalThis as { graffiti?: unknown }).graffiti = {
    board: BOARD_ID,
    identity,
    connection: surface.connectionId,
    livePush: surface.livePush,
    surface,
  };
}

const ready = boot().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  status(`Boot failed: ${message}`, 'error');
  throw error;
});
(globalThis as { graffitiReady?: unknown }).graffitiReady = ready;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
