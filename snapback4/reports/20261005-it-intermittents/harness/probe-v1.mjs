import { channel } from 'node:diagnostics_channel';
import { readFileSync, readdirSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
const read = p => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const errorData = e => e && ({name:e.name, code:e.code, message:e.message, cause:errorData(e.cause)});
const emit = (kind, data) => process.stderr.write(`IT_DIAGNOSTIC ${JSON.stringify({kind, pid:process.pid, at:new Date().toISOString(), ...data})}\n`);
channel('undici:client:connectError').subscribe(({connectParams,error}) => {
 emit('connectError',{host:connectParams.hostname,port:connectParams.port,error:errorData(error),sockstat:read('/proc/net/sockstat'),netstat:read('/proc/net/netstat'),fds:readdirSync('/proc/self/fd').length,limits:read('/proc/self/limits'),lagMaxMs:lag.max/1e6});
});
const hostFetch = globalThis.fetch;
globalThis.fetch = async function(input,init) {
 const began=performance.now();
 try { return await hostFetch(input,init); }
 catch(error) {
  if (!init?.signal?.aborted) emit('fetchError',{url:String(input),ms:performance.now()-began,error:errorData(error),sockstat:read('/proc/net/sockstat'),fds:readdirSync('/proc/self/fd').length,lagMaxMs:lag.max/1e6});
  throw error;
 }
};
