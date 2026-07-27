// LLP 0094 §0B kit half (B2): the open-time `wireVersion` offer, the §0B.3
// echo witness on the grant, and the §0B.6 legacy-server detection fallback
// (exact decode-class trigger, one offerless differential re-open per
// endpoint, process-lifetime verdict cache, structured downgrade diagnostic,
// optional strict mode).
import assert from 'node:assert/strict';
import http from 'node:http';

import { SnapbackClient } from './index.mjs';

const listen = (handler) => new Promise((resolve) => {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      handler(request, response, body);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    resolve({
      server,
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => server.close(done)),
    });
  });
});

const grantResponse = (response, body, { echo }) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    connectionId: body.connectionId ?? 'conn_fixture',
    connectionToken: 'sct_fixture_token',
    ...(echo ? { wireVersion: 'snapback.v1' } : {}),
  }));
};

const decodeRefusal = (response) => {
  response.writeHead(400, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    diagnostic: {
      code: 'SNAPBACK_REQUEST_JSON_INVALID',
      message: 'request body was not valid JSON for this operation',
    },
  }));
};

// --- a version-aware (B1) server: the kit offers and keeps the echo --------
{
  const seen = [];
  const modern = await listen((request, response, body) => {
    seen.push(body);
    if (body.wireVersion !== undefined && body.wireVersion !== 'snapback.v1') {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        diagnostic: { code: 'SNAPBACK_WIRE_VERSION_UNSUPPORTED', message: 'unsupported' },
      }));
      return;
    }
    grantResponse(response, body, { echo: body.wireVersion === 'snapback.v1' });
  });
  const client = new SnapbackClient(modern.url);
  const grant = await client.connectionGrant('modern-conn');
  assert.equal(seen.length, 1, 'a version-aware server needs exactly one open');
  assert.equal(seen[0].wireVersion, 'snapback.v1', 'the kit must offer at open (B2)');
  assert.equal(grant.wireVersion, 'snapback.v1', 'the grant carries the §0B.3 echo witness');
  assert.deepEqual(client.wireVersionDiagnostics, [], 'a bound open surfaces no diagnostic');
  await modern.close();
}

// --- a pre-B1 legacy server: decode-class rejection → one offerless re-open,
// cached verdict, structured downgrade diagnostic ---------------------------
{
  const seen = [];
  const legacy = await listen((request, response, body) => {
    seen.push(body);
    if (body.wireVersion !== undefined) {
      decodeRefusal(response);
      return;
    }
    grantResponse(response, body, { echo: false });
  });
  const surfaced = [];
  const client = new SnapbackClient(legacy.url, {
    onWireVersionDiagnostic: (diagnostic) => surfaced.push(diagnostic),
  });
  const grant = await client.connectionGrant('legacy-conn');
  assert.equal(seen.length, 2, 'exactly one offerless differential re-open');
  assert.equal(seen[0].wireVersion, 'snapback.v1');
  assert.equal(seen[1].wireVersion, undefined, 'the re-open removes the offer member alone');
  assert.equal(seen[1].connectionId, seen[0].connectionId);
  assert.equal(grant.wireVersion, null, 'a legacy grant carries no echo');
  assert.equal(surfaced.length, 1, 'the downgrade is surfaced, never silent');
  assert.equal(surfaced[0].code, 'SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADED');
  assert.equal(surfaced[0].details.endpoint, legacy.url);
  assert.equal(client.wireVersionDiagnostics.length, 1);

  // The verdict is cached per endpoint for the process lifetime: a second
  // open (same client or a new one against the same base URL) goes offerless
  // immediately, with no re-probe and no second diagnostic.
  await client.connectionGrant('legacy-conn-2');
  assert.equal(seen.length, 3, 'a cached legacy verdict opens offerless in one request');
  assert.equal(seen[2].wireVersion, undefined);
  assert.equal(surfaced.length, 1, 'the cached verdict re-surfaces nothing');
  const sibling = new SnapbackClient(legacy.url);
  await sibling.connectionGrant('legacy-conn-3');
  assert.equal(seen.length, 4);
  assert.equal(seen[3].wireVersion, undefined, 'the verdict cache is per endpoint, not per client');
  const strictSurfaced = [];
  const strictSibling = new SnapbackClient(legacy.url, {
    strictWireVersion: true,
    onWireVersionDiagnostic: (diagnostic) => strictSurfaced.push(diagnostic),
  });
  await assert.rejects(
    strictSibling.connectionGrant('legacy-strict-after-cache'),
    (error) => error.diagnostic?.code === 'SNAPBACK_CLIENT_WIRE_VERSION_STRICT',
  );
  assert.equal(seen.length, 4, 'strict mode never follows a cached legacy verdict offerless');
  assert.equal(strictSurfaced.length, 1);
  await legacy.close();
}

// --- strict mode refuses instead of downgrading ----------------------------
{
  const seen = [];
  const legacy = await listen((request, response, body) => {
    seen.push(body);
    if (body.wireVersion !== undefined) {
      decodeRefusal(response);
      return;
    }
    grantResponse(response, body, { echo: false });
  });
  const surfaced = [];
  const client = new SnapbackClient(legacy.url, {
    strictWireVersion: true,
    onWireVersionDiagnostic: (diagnostic) => surfaced.push(diagnostic),
  });
  await assert.rejects(
    client.connectionGrant('strict-conn'),
    (error) => error.diagnostic?.code === 'SNAPBACK_CLIENT_WIRE_VERSION_STRICT',
  );
  assert.equal(seen.length, 1, 'strict mode never re-opens offerless');
  assert.equal(surfaced.length, 1);
  assert.equal(surfaced[0].code, 'SNAPBACK_CLIENT_WIRE_VERSION_STRICT');
  await legacy.close();
}

// --- hosted pre-B1 shape: successful offered open without the B1 echo ------
{
  const seen = [];
  const preB1Hosted = await listen((request, response, body) => {
    seen.push(body);
    grantResponse(response, body, { echo: false });
  });
  const surfaced = [];
  const client = new SnapbackClient(preB1Hosted.url, {
    onWireVersionDiagnostic: (diagnostic) => surfaced.push(diagnostic),
  });
  const grant = await client.connectionGrant('hosted-pre-b1');
  assert.equal(seen.length, 1, 'the successful offered open itself establishes the legacy grant');
  assert.equal(seen[0].wireVersion, 'snapback.v1');
  assert.equal(grant.wireVersion, null);
  assert.equal(surfaced.length, 1, 'the missing B1 echo is a surfaced downgrade');
  assert.equal(surfaced[0].details.detection, 'missing wireVersion response echo');

  await client.connectionGrant('hosted-pre-b1-cached');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].wireVersion, undefined, 'the missing-echo verdict is process-cached');

  const strictSurfaced = [];
  const strictClient = new SnapbackClient(preB1Hosted.url, {
    strictWireVersion: true,
    onWireVersionDiagnostic: (diagnostic) => strictSurfaced.push(diagnostic),
  });
  await assert.rejects(
    strictClient.connectionGrant('hosted-pre-b1-strict'),
    (error) => error.diagnostic?.code === 'SNAPBACK_CLIENT_WIRE_VERSION_STRICT',
  );
  assert.equal(seen.length, 2, 'strict mode refuses a cached missing-echo verdict before I/O');
  assert.equal(strictSurfaced.length, 1);
  await preB1Hosted.close();
}

// --- strict missing-echo refusal still caches the endpoint verdict ---------
{
  const seen = [];
  const preB1Hosted = await listen((request, response, body) => {
    seen.push(body);
    grantResponse(response, body, { echo: false });
  });
  const strictSurfaced = [];
  const strictClient = new SnapbackClient(preB1Hosted.url, {
    strictWireVersion: true,
    onWireVersionDiagnostic: (diagnostic) => strictSurfaced.push(diagnostic),
  });
  await assert.rejects(
    strictClient.connectionGrant('strict-missing-echo-first'),
    (error) => error.diagnostic?.code === 'SNAPBACK_CLIENT_WIRE_VERSION_STRICT',
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].wireVersion, 'snapback.v1');
  assert.equal(strictSurfaced.length, 1);

  const nonStrictSurfaced = [];
  const sibling = new SnapbackClient(preB1Hosted.url, {
    onWireVersionDiagnostic: (diagnostic) => nonStrictSurfaced.push(diagnostic),
  });
  await sibling.connectionGrant('after-strict-missing-echo');
  assert.equal(seen.length, 2);
  assert.equal(
    seen[1].wireVersion,
    undefined,
    'a later non-strict sibling consumes the verdict without re-probing',
  );
  assert.deepEqual(
    nonStrictSurfaced,
    [],
    'the process verdict was already surfaced by the strict diagnostic',
  );
  await preB1Hosted.close();
}

// --- an offered response may echo only the exact token ---------------------
{
  const invalidEcho = await listen((request, response, body) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      connectionId: body.connectionId,
      connectionToken: 'sct_invalid_echo',
      wireVersion: 'snapback.v2',
    }));
  });
  const surfaced = [];
  const client = new SnapbackClient(invalidEcho.url, {
    onWireVersionDiagnostic: (diagnostic) => surfaced.push(diagnostic),
  });
  await assert.rejects(
    client.connectionGrant('invalid-echo'),
    (error) => error.diagnostic?.code === 'SNAPBACK_CLIENT_WIRE_VERSION_ECHO_INVALID',
  );
  assert.equal(surfaced.length, 1);
  await invalidEcho.close();
}

// --- concurrent first opens share one endpoint probe ----------------------
{
  const seen = [];
  const legacy = await listen((request, response, body) => {
    seen.push(body);
    if (body.wireVersion !== undefined) {
      setTimeout(() => decodeRefusal(response), 10);
      return;
    }
    grantResponse(response, body, { echo: false });
  });
  const surfaced = [];
  const first = new SnapbackClient(legacy.url, {
    onWireVersionDiagnostic: (diagnostic) => surfaced.push(diagnostic),
  });
  const second = new SnapbackClient(legacy.url, {
    onWireVersionDiagnostic: (diagnostic) => surfaced.push(diagnostic),
  });
  await Promise.all([
    first.connectionGrant('concurrent-a'),
    second.connectionGrant('concurrent-b'),
  ]);
  assert.equal(
    seen.filter((body) => body.wireVersion === 'snapback.v1').length,
    1,
    'only the process-wide leader probes an unknown endpoint',
  );
  assert.equal(
    seen.filter((body) => body.wireVersion === undefined).length,
    2,
    'the leader retries once and the follower opens once after the cached verdict',
  );
  assert.equal(surfaced.length, 1, 'the process-wide downgrade is surfaced once');
  await legacy.close();
}

// --- SNAPBACK_WIRE_VERSION_UNSUPPORTED MUST NOT trigger the fallback -------
{
  const seen = [];
  const refusing = await listen((request, response, body) => {
    seen.push(body);
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
        message: 'a version-aware refusal, not a decode failure',
      },
    }));
  });
  const client = new SnapbackClient(refusing.url);
  await assert.rejects(
    client.connectionGrant('refused-conn'),
    (error) => error.diagnostic?.code === 'SNAPBACK_WIRE_VERSION_UNSUPPORTED',
  );
  assert.equal(seen.length, 1, 'a version-aware refusal is terminal: no offerless re-try');
  assert.deepEqual(client.wireVersionDiagnostics, []);
  await refusing.close();
}

// --- the decode code at any status other than 400 is not the pinned signal -
{
  const seen = [];
  const refusing = await listen((request, response, body) => {
    seen.push(body);
    response.writeHead(422, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_REQUEST_JSON_INVALID',
        message: 'same code, wrong status: not the legacy-server signal',
      },
    }));
  });
  const client = new SnapbackClient(refusing.url);
  await assert.rejects(
    client.connectionGrant('wrong-status-decode-code'),
    (error) => (
      error.status === 422
      && error.diagnostic?.code === 'SNAPBACK_REQUEST_JSON_INVALID'
    ),
  );
  assert.equal(seen.length, 1, 'HTTP 422 with the decode code never retries offerless');
  assert.deepEqual(client.wireVersionDiagnostics, []);
  await refusing.close();
}

// --- a failed differential proves nothing: no verdict is cached ------------
{
  const seen = [];
  const broken = await listen((request, response) => {
    seen.push(true);
    decodeRefusal(response);
  });
  const client = new SnapbackClient(broken.url, {
    onWireVersionDiagnostic: () => {},
  });
  await assert.rejects(
    client.connectionGrant('broken-conn'),
    (error) => error.diagnostic?.code === 'SNAPBACK_REQUEST_JSON_INVALID',
  );
  assert.equal(seen.length, 2, 'the differential ran once and failed');
  assert.deepEqual(client.wireVersionDiagnostics, [], 'no downgrade happened, none is surfaced');
  // The next open offers again — a failed probe recorded no legacy verdict.
  await assert.rejects(client.connectionGrant('broken-conn'));
  assert.equal(seen.length, 4);
  await broken.close();
}

console.log('snapback-client wire-version tests passed');
