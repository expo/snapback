// API signatures: snapback4 guide api proof
import { startServe, startStatic, serveUntilSignal, cleanup } from "snapback4/proof";
const provisionUsers = SEED_PLAN ?? { users: 2 };
const backend = await startServe(process.env.SNAPBACK4_PROD_DIRECTORY ?? "production", { provisionUsers });
let frontend;
try {
  frontend = await startStatic("dist");
  // Both starter clients support ?api=, so the ready page uses this run's
  // backend even when PORT_LO..PORT_HI selected a different free port.
  const frontendUrl = new URL(frontend.url);
  frontendUrl.searchParams.set("api", backend.url);
  console.log(JSON.stringify({ backendUrl: backend.url, frontendUrl: frontendUrl.href, sessions: backend.sessions }));
  await serveUntilSignal([backend, frontend]);
} finally { await cleanup(() => frontend?.stop(), () => backend.stop()); }
