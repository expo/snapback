(async function() {
  var invocation = JSON.parse("
__SNAPBACK_INVOCATION_JSON__
");
  return await globalThis.__snapbackSettle(invocation.export, invocation.argsJson, invocation.authJson, invocation.mode, invocation.runJson, invocation.secretsJson, invocation.epoch);
})()
