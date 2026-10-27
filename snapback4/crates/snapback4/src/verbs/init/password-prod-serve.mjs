// API signatures: snapback4 guide api proof
import { startServe, startStatic, serveUntilSignal, cleanup } from "snapback4/proof";
const provisionUsers = SEED_PLAN;
const backend = await startServe(process.env.SNAPBACK4_PROD_DIRECTORY ?? "production", provisionUsers ? { provisionUsers } : {});
let frontend;
try {
  frontend = await startStatic("dist");
  console.log(JSON.stringify({ backendUrl: backend.url, frontendUrl: frontend.url, sessions: backend.sessions }));
  await serveUntilSignal([backend, frontend]);
} finally { await cleanup(() => frontend?.stop(), () => backend.stop()); }
