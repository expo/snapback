import { SnapbackClient } from '../../../_kit/client.mjs';
import api from '../../snapback/generated/api.mjs';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';

type QueryName = 'listEvents' | 'eventDetails' | 'guestList' | 'eventWall';
type MutationName = 'createEvent' | 'rsvp' | 'postMessage';

/**
 * Language-neutral HTTP projection of the generated Snapback app.
 *
 * The browser rows exercise Snapback's native JS push client. Apple-native
 * Swift has no Snapback SDK yet, so the native comparison deliberately uses
 * the same JSON request contract for all four providers. Provisioning stays
 * idempotent and lazy so the gateway can start before the local Snapback
 * process without erasing cross-cell state.
 *
 * @ref LLP 0034#5 — native gateway mounts ensure the app and never reset it.
 */
export function createSnapbackAdapter(
  origin = process.env.PARTIFUL_MATRIX_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4433',
) {
  const client = new SnapbackClient(origin);
  let ensured: Promise<void> | undefined;

  function ensure() {
    ensured ??= (async () => {
      await client.health();
      await client.ensureApp({
        schema: schemaManifest,
        functions: functionsManifest,
        seed,
      });
    })();
    return ensured;
  }

  return {
    backend: 'snapback',
    async query(name: string, args: Record<string, unknown>) {
      await ensure();
      const ref = api[name as QueryName];
      if (!ref) throw new Error(`unknown query: ${name}`);
      const result = await client.query(ref, {
        args,
        userId: 'user_native_matrix',
      });
      return result.rows;
    },
    async mutate(
      name: string,
      args: Record<string, unknown>,
      userId: string,
    ) {
      await ensure();
      const ref = api[name as MutationName];
      if (!ref) throw new Error(`unknown mutation: ${name}`);
      const result = await client.mutate(ref, { args, userId });
      return result.result;
    },
    close() {},
  };
}
