import {appendFileSync} from 'node:fs';

// The lane5 harness deliberately owns its gateway, but its landed source pipes
// gateway stdio without consuming it. This diagnostic-only preload drains and
// tees those pipes into the gate scratch namespace. It does not alter the lane
// receipt or gateway protocol.
const outputFile = process.env.ZBUGS_PROCESS_OUTPUT_FILE;

if (outputFile) {
  const originalSpawn = Bun.spawn.bind(Bun);
  Bun.spawn = function capturedSpawn(...args) {
    const child = originalSpawn(...args);
    capture(child.stdout, 'gateway stdout');
    capture(child.stderr, 'gateway stderr');
    return child;
  };
}

function capture(stream, label) {
  if (!stream || typeof stream.getReader !== 'function') return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  append(`[${label}]\n`);
  void (async () => {
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        append(decoder.decode(value, {stream: true}));
      }
      append(decoder.decode());
    } catch (error) {
      append(`[capture failed: ${error instanceof Error ? error.message : String(error)}]\n`);
    }
  })();
}

function append(value) {
  try {
    appendFileSync(outputFile, value, {encoding: 'utf8', mode: 0o600});
  } catch {
    // Diagnostics must never change the behavior under test.
  }
}
