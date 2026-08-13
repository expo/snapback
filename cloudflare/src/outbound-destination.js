// Cloudflare's host-mediated outbound destination floor.
//
// Workers exposes URL parsing and fetch redirect control, but no API that
// resolves a hostname and pins the resulting addresses to the subsequent
// fetch. This port can therefore classify only authored hostnames and IP
// literals. A public-looking hostname that later resolves to a private address
// remains an explicit target residual; this profile must not claim DNS-pinned
// or multi-tenant-SSRF-proof egress until Workers supplies that primitive.
//
// @ref LLP 0251#shared-primitive — port the webhook IP/hostname predicates at
//   the last host-owned boundary without pretending Workers can pin DNS.

const MAX_OUTBOUND_URL_BYTES = 4096;
const UTF8_ENCODER = new TextEncoder();

function parseIpv4(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^(?:0|[1-9][0-9]{0,2})$/.test(part) ? Number(part) : -1));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function ipv4TailSegments(token) {
  const octets = parseIpv4(token);
  if (!octets) return null;
  return [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
}

function parseIpv6(hostname) {
  let input = hostname;
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  if (input.length === 0 || input.includes('%') || input.split('::').length > 2) return null;
  const parseSide = (side) => {
    if (side === '') return [];
    const tokens = side.split(':');
    const segments = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token.includes('.')) {
        if (index !== tokens.length - 1) return null;
        const tail = ipv4TailSegments(token);
        if (!tail) return null;
        segments.push(...tail);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
        segments.push(Number.parseInt(token, 16));
      }
    }
    return segments;
  };
  const compressed = input.includes('::');
  const [leftText, rightText = ''] = input.split('::');
  const left = parseSide(leftText);
  const right = parseSide(rightText);
  if (!left || !right) return null;
  if (!compressed) return left.length === 8 ? left : null;
  const omitted = 8 - left.length - right.length;
  if (omitted < 1) return null;
  return [...left, ...Array(omitted).fill(0), ...right];
}

export function isPublicIpv4Literal(hostname) {
  const octets = parseIpv4(hostname);
  if (!octets) return null;
  const [a, b, c, d] = octets;
  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
    || (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

export function isPublicIpv6Literal(hostname) {
  const segments = parseIpv6(hostname);
  if (!segments) return null;
  const mapped = segments.slice(0, 5).every((segment) => segment === 0)
    && segments[5] === 0xffff;
  if (mapped) {
    const ipv4 = `${segments[6] >> 8}.${segments[6] & 0xff}.${segments[7] >> 8}.${segments[7] & 0xff}`;
    return isPublicIpv4Literal(ipv4);
  }
  const first = segments[0];
  return !(
    (first & 0xe000) !== 0x2000
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first === 0x2001 && segments[1] === 0x0db8)
  );
}

function normalizedHostname(hostname) {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

export function admitOutboundDestination(urlText) {
  const authored = String(urlText ?? '');
  if (
    authored.length === 0
    || UTF8_ENCODER.encode(authored).byteLength > MAX_OUTBOUND_URL_BYTES
    || /[\u0000-\u001f\u007f]/u.test(authored)
  ) {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', reason: 'invalid-url-shape' };
  }
  let url;
  try {
    url = new URL(authored);
  } catch (_) {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', reason: 'invalid-url-shape' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', reason: 'unsupported-scheme' };
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', reason: 'credentials-or-fragment' };
  }
  const host = normalizedHostname(url.hostname.replace(/^\[|\]$/gu, ''));
  if (host.length === 0) {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', reason: 'missing-hostname' };
  }
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === 'metadata'
    || host === 'metadata.google.internal'
  ) {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED', reason: 'reserved-hostname' };
  }
  const publicIpv4 = isPublicIpv4Literal(host);
  if (publicIpv4 === false) {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED', reason: 'non-public-ip-literal' };
  }
  const publicIpv6 = host.includes(':') ? isPublicIpv6Literal(host) : null;
  if (publicIpv6 === false) {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED', reason: 'non-public-ip-literal' };
  }
  if ((/^\d+(?:\.\d+){3}$/u.test(host) && publicIpv4 === null) || (host.includes(':') && publicIpv6 === null)) {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', reason: 'invalid-ip-literal' };
  }
  return { ok: true, url };
}

export function isRedirectStatus(status) {
  return Number.isSafeInteger(status) && status >= 300 && status < 400;
}
