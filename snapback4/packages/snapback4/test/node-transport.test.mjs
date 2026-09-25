import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// The throw is deliberately on the asynchronous socket-connect callback.
// A fetch promise catch cannot contain the bundled Node 24.18 writer's bug.
const probe = transport => spawnSync(process.execPath, ["--input-type=module", "-e", `
  import { createServer } from 'node:http';
  import { Socket } from 'node:net';
  import { defaultFetch } from ${JSON.stringify(new URL("../dist/node-fetch.js", import.meta.url).href)};
  let markings = 0;
  Socket.prototype.setTypeOfService = function () {
    markings++;
    throw Object.assign(Error('setTypeOfService EINVAL'), { code: 'EINVAL', syscall: 'setTypeOfService' });
  };
  const server = createServer((request, response) => response.end('acknowledged')).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await ${transport}('http://127.0.0.1:' + server.address().port);
    console.log(JSON.stringify({ text: await response.text(), markings }));
  } finally { server.closeAllConnections(); server.close(); }
`], { encoding: "utf8", timeout: 10_000 });

test("Node default transport does not call unsupported socket QoS on ordinary requests", () => {
  const result = probe("defaultFetch");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { text: "acknowledged", markings: 0 });
});
