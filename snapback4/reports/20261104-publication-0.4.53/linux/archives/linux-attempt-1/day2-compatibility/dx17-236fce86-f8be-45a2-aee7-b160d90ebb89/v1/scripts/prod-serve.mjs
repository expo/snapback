import {startServe, serveUntilSignal, cleanup} from 'snapback4/proof';
import {api} from '../snapback/generated/api.ts';
const host = await startServe('./deploy', {
  provisionUsers:{roles:{member:2, admin:2}, provision:api.provision}
});
try {
  const serving = serveUntilSignal([host]);
  console.log(JSON.stringify({backendUrl:host.url, users:host.sessions}));
  await serving;
} finally { await cleanup(() => host.stop()); }
