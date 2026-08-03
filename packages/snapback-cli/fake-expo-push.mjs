import { createServer } from 'node:http';

const SEND_PATH = '/--/api/v2/push/send';
const RECEIPTS_PATH = '/--/api/v2/push/getReceipts';
const BODY_LIMIT = 256 * 1024;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > BODY_LIMIT) {
        reject(new Error('fake Expo request exceeded the fixture body limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function normalizeOutcome(outcome) {
  if (outcome === 'ok') return { ticket: 'ok', receipt: 'ok' };
  if (outcome?.ticketError) return { ticket: 'error', code: outcome.ticketError };
  if (outcome?.receiptError) {
    return { ticket: 'ok', receipt: 'error', code: outcome.receiptError };
  }
  if (outcome?.receiptPending) return { ticket: 'ok', receipt: 'pending' };
  throw new TypeError(`unknown fake Expo outcome ${JSON.stringify(outcome)}`);
}

/**
 * Shared deterministic LLP 0143 provider fixture. Each queued send plan is
 * consumed once. Plans can return successful tickets, ticket-stage errors,
 * receipt-stage errors, pending receipts, or destroy the socket after reading
 * the POST to create genuine response ambiguity.
 */
export async function startFakeExpoPushService() {
  const plans = [];
  const receipts = new Map();
  const sends = [];
  const receiptPolls = [];
  let ticketSequence = 0;

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === SEND_PATH) {
        const messages = await readJson(req);
        if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
          writeJson(res, 400, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] });
          return;
        }
        const plan = plans.shift() ?? { kind: 'tickets', outcomes: messages.map(() => 'ok') };
        sends.push({ messageCount: messages.length, planKind: plan.kind });
        if (plan.kind === 'socket-drop') {
          req.socket.destroy();
          return;
        }
        if (plan.outcomes.length !== messages.length) {
          writeJson(res, 400, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] });
          return;
        }
        const data = plan.outcomes.map((rawOutcome) => {
          const outcome = normalizeOutcome(rawOutcome);
          if (outcome.ticket === 'error') {
            return {
              status: 'error',
              message: 'fixture prose must not be persisted',
              details: { error: outcome.code },
            };
          }
          ticketSequence += 1;
          const ticketId = `fake-expo-ticket-${ticketSequence}`;
          if (outcome.receipt === 'ok') {
            receipts.set(ticketId, { status: 'ok' });
          } else if (outcome.receipt === 'error') {
            receipts.set(ticketId, {
              status: 'error',
              message: 'fixture receipt prose must not be persisted',
              details: { error: outcome.code },
            });
          }
          return { status: 'ok', id: ticketId };
        });
        writeJson(res, 200, { data });
        return;
      }

      if (req.method === 'POST' && req.url === RECEIPTS_PATH) {
        const body = await readJson(req);
        const ids = Array.isArray(body?.ids) ? body.ids : [];
        receiptPolls.push({ ticketCount: ids.length });
        const data = {};
        for (const id of ids) {
          if (receipts.has(id)) data[id] = receipts.get(id);
        }
        writeJson(res, 200, { data });
        return;
      }

      writeJson(res, 404, { error: 'fake Expo route not found' });
    } catch {
      if (!res.headersSent) writeJson(res, 400, { error: 'invalid fake Expo request' });
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    sends,
    receiptPolls,
    enqueueTickets(outcomes) {
      if (!Array.isArray(outcomes) || outcomes.length === 0 || outcomes.length > 100) {
        throw new TypeError('enqueueTickets expects 1..100 scripted outcomes');
      }
      plans.push({ kind: 'tickets', outcomes: [...outcomes] });
    },
    enqueueSocketDrop() {
      plans.push({ kind: 'socket-drop' });
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    },
  };
}
