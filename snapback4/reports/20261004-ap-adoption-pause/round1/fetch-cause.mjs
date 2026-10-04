// Probe only: preserve fetch behavior and print no headers, body or query values.
const apFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (...args) => {
  try { return await apFetch(...args); }
  catch (error) {
    let destination;
    try { const u = new URL(typeof args[0] === 'string' ? args[0] : args[0].url ?? String(args[0])); destination = u.origin + u.pathname; } catch {}
    const cause = error.cause;
    console.error('AP_FETCH_FAILURE', JSON.stringify({destination, message:error.message, cause: cause && {name:cause.name,message:cause.message,code:cause.code,errno:cause.errno,syscall:cause.syscall,address:cause.address,port:cause.port}}));
    throw error;
  }
};
