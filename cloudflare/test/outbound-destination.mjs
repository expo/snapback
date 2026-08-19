// LLP 0251 destination floor parity: the JS port must classify the same
// literal forms and refuse the same authority/hop-by-hop header names as the
// Rust `outbound_policy` floor, so a coordinator deploy can never be the
// weaker egress edge.
import assert from 'node:assert/strict';

import {
  admitOutboundDestination,
  isForbiddenOutboundHeaderName,
  isPublicIpv4Literal,
  isPublicIpv6Literal,
} from '../src/outbound-destination.js';

// HTTPS-only and compact IPv4 literal classification.
for (const literal of ['127.1', '2130706433', '0x7f000001']) {
  assert.equal(isPublicIpv4Literal(literal), false, literal);
  assert.deepEqual(admitOutboundDestination(`https://${literal}/private`), {
    ok: false,
    code: 'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED',
    reason: 'non-public-ip-literal',
  });
}

assert.equal(admitOutboundDestination('https://93.184.216.34/').ok, true);
assert.deepEqual(admitOutboundDestination('http://example.com/'), {
  ok: false,
  code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID',
  reason: 'unsupported-scheme',
});
assert.deepEqual(admitOutboundDestination('http://1.1.1.1/'), {
  ok: false,
  code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID',
  reason: 'unsupported-scheme',
});

// IPv6 transition and documentation ranges mirror the Rust floor.
for (const literal of [
  '2002:a00:1::',
  '2002:a01:203::1',
  '2002:c000:201::',
  '2001:0:4136:e378:8000:63bf:f5ff:fffe',
  '2001:0:4136:e378:8000:63bf:3fff:fdfe',
  '2001:0:c0a8:1::',
  '3fff::1',
  '3fff:fff::1',
  '::ffff:169.254.169.254',
  'fd00::1',
  'fe80::1',
]) {
  assert.equal(isPublicIpv6Literal(literal), false, literal);
  const admitted = admitOutboundDestination(`https://[${literal}]/private`);
  assert.equal(admitted.ok, false, literal);
  assert.equal(admitted.reason, 'non-public-ip-literal', literal);
}

for (const literal of [
  '2001:4860:4860::8888',
  '2002:808:808::',
  '2001:0:4136:e378:8000:63bf:f7f7:f7f7',
]) {
  assert.equal(isPublicIpv6Literal(literal), true, literal);
  assert.equal(admitOutboundDestination(`https://[${literal}]/`).ok, true, literal);
}

// Authority and hop-by-hop header refusal matches the Rust set.
for (const name of [
  'Host',
  ':AUTHORITY',
  'Transfer-Encoding',
  'content-length',
  'Connection',
  'KEEP-ALIVE',
  'upgrade',
  'TE',
  'Trailer',
  'Proxy-Authorization',
  'X-Forwarded-For',
  'x-forwarded-host',
  'Forwarded',
]) {
  assert.equal(isForbiddenOutboundHeaderName(name), true, name);
}
for (const name of ['Authorization', 'Accept', 'X-Request-Id', 'Forwardedness']) {
  assert.equal(isForbiddenOutboundHeaderName(name), false, name);
}

console.log(
  'cloudflare outbound-destination tests: https-only, compact IPv4, IPv6 transition ranges, and header refusal parity passed',
);
