// API signatures: snapback4 guide api proof | client | auth | generated
// KEEP REGION: development probe lifetime, explicit hold and owned cleanup.
import { probeServeGuard, deploy, startServe, serveUntilSignal } from 'snapback4/proof';
const guard = probeServeGuard();
const directory = process.env.SNAPBACK4_PROBE_DIRECTORY ?? '.snapback4/probe';
await deploy(`${directory}/release`, 'snapback');
const host = await startServe(`${directory}/release`);
try {
  const held = serveUntilSignal([host]);
  console.log(JSON.stringify({backendUrl:host.url, sessions:{}}));
  await held;
} finally { guard.close(); await host.stop(); }
