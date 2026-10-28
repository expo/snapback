// Standalone alternative for probe:serve; keep VER1/starter launchers if already customized.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { probeServeGuard, serveUntilSignal } from 'snapback4/proof';
import { startProof } from './host.mjs';
const guard=probeServeGuard(); let ctx;
try {
  ctx=await startProof({directory:process.env.SNAPBACK4_PROBE_DIRECTORY});
  const credentialsFile=join(ctx.directory,`users-${randomUUID()}.json`);
  writeFileSync(credentialsFile,JSON.stringify(ctx.sessions),{flag:'wx',mode:0o600});
  // sessions[role] contains {email,password,principal,token,kind:'user',expiresAt,role}.
  // Passwords/tokens stay in this private file; only its path enters readiness.
  console.log(JSON.stringify({backendUrl:ctx.host.url,credentialsFile,now:await ctx.host.now()}));
  await serveUntilSignal([ctx]);
} finally { guard.close(); if(ctx) await ctx.stop(); }
