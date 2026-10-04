// Register before readiness listeners: stderr can arrive between any two
// stdout chunks, including a port and its line terminator.
export function captureStdout(child) {
  let stdout = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  return () => stdout;
}
