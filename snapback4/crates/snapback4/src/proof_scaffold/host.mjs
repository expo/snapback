// KEEP lifecycle/helpers; customize accountPlan and setup in cases.mjs.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deploy, startServe } from 'snapback4/proof';
import { login } from 'snapback4/auth';
import { createClient } from 'snapback4/client';
import { accountPlan, setup } from './cases.mjs';
export const schema = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url)));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1kAAAAASUVORK5CYII=', 'base64');
export async function startProof(options = {}) {
  assert.equal(schema.password, true, 'E_PROOF_SCENARIO: real-user proofs require use identity password; this scaffold never changes auth');
  const directory = options.directory ? resolve(options.directory) : mkdtempSync(join(tmpdir(), 'sb4-proof-'));
  const release = join(directory, 'release');
  let host;
  try {
    await deploy(release, 'snapback', { args: ['--staging'] });
    host = await startServe(release, { seedUsers: accountPlan });
    const sessions = host.sessions;
    // Explicit sign-in proves the ordinary password path, not just signup's first token.
    for (const accounts of Object.values(sessions)) for (const account of accounts) {
      const signed = await login(host.url, account.email, account.password);
      assert.equal(signed.ok, true, `sign-in ${account.role}`);
      assert.equal(signed.session.principal, account.principal);
      Object.assign(account, signed.session);
    }
    const ctx = { host, directory, release, sessions, schema, rows: Object.create(null),
      async call(op, account, args) {
        const fact = schema.operations.find(p => p.name === op);
        assert.ok(fact, `unknown proof operation ${op}`);
        const response = await fetch(`${host.url}/${fact.kind === 'query' ? 'q' : fact.kind === 'action' ? 'a' : 'm'}/${op}`, {
          method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${account.token}`},
          body:JSON.stringify({args, ...(fact.kind !== 'query' ? {id:randomUUID()} : {})}), signal:AbortSignal.timeout(30000),
        });
        const result = await response.json();
        // Preserve the actual refusal for the assertion; HTTP status alone is not a proof.
        return result;
      },
      async upload(account, kind, type = 'text/plain', bytes) {
        // Image: NO file option. File: explicit MIME/name, verified against actual bytes.
        if (!bytes && kind === 'file' && type !== 'text/plain') throw Error(`E_PROOF_SCENARIO: supply real ${type} fixture bytes to ctx.upload`);
        const client = createClient({url:host.url, session:account});
        try {
          const result = await client.upload(bytes ?? (kind === 'image' ? png : new TextEncoder().encode('Proof document')), kind === 'file' ? {file:{type, name:type === 'text/plain' ? 'proof.txt' : 'proof.bin'}} : undefined);
          assert.equal(result.ok, true, `upload ${kind}: ${JSON.stringify(result)}`);
          return result.asset.id;
        } finally { await client.close(); }
      },
      assertApproval(row, account, reason, {by, why}) {
        assert.ok(row, 'approval reread missing');
        assert.equal(row[by], account.principal, 'approval must record who');
        assert.equal(row[why], reason, 'approval must record why');
      },
    };
    await setup(ctx);
    let stopped;
    return Object.assign(ctx, {stop: () => stopped ??= (async () => { await host.stop(); if (!options.directory) rmSync(directory, {recursive:true,force:true}); })()});
  } catch(error) {
    if(host) await host.stop();
    if(!options.directory) rmSync(directory,{recursive:true,force:true});
    throw error;
  }
}
