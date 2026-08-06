/// <reference types="bun" />

import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

import {createExternalSessionClient} from '@expo/snapback-client';

import {actorEmail} from '../../scripts/bind-actors.mts';
import {mintDevSession} from '../../scripts/load-fixture.mts';
import {
  renderIntentDeliveries,
  type IntentSnapshot,
  type RenderedDelivery,
} from './payloads.mts';

type JsonRecord = Record<string, unknown>;
type FaultMode = 'none' | 'fail-before-send' | 'fail-after-send-before-receipt';

const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
const GENERATED_API_PATH = join(CONTROL_ROOT, 'snapback/generated/api.mjs');
const DEFAULT_READY_FILE = join(CONTROL_ROOT, '.snapback/dev.ready.json');
const DEFAULT_GATEWAY_READY_FILE = join(CONTROL_ROOT, '.snapback/lane5-gateway.ready.json');

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function testSecret(name: string, fallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.ZERBUGS_TEST_DEFAULTS === '1') return fallback;
  throw new Error(`${name} is required (test defaults require ZERBUGS_TEST_DEFAULTS=1)`);
}

function requestedFault(args: readonly string[]): FaultMode {
  const value = args.find(arg => arg.startsWith('--fault='))?.slice('--fault='.length)
    ?? process.env.ZERBUGS_EFFECT_FAULT
    ?? 'none';
  if (!['none', 'fail-before-send', 'fail-after-send-before-receipt'].includes(value)) {
    throw new TypeError('effect fault must be none, fail-before-send, or fail-after-send-before-receipt');
  }
  return value as FaultMode;
}

function matchingDelivery(
  deliveries: readonly RenderedDelivery[],
  attempt: JsonRecord,
): RenderedDelivery {
  const delivery = deliveries.find(candidate => (
    candidate.channel === attempt.channel && candidate.recipientKey === attempt.recipientKey
  ));
  if (!delivery || delivery.idempotencyKey !== attempt.providerIdempotencyKey) {
    throw new Error('leased attempt does not match the rendered stable provider identity');
  }
  return delivery;
}

export async function deliverTick(options: Readonly<{
  readyFile: string;
  gatewayReadyFile: string;
  fault: FaultMode;
  maxIntents: number;
}>): Promise<JsonRecord> {
  if (!Number.isSafeInteger(options.maxIntents) || options.maxIntents < 1 || options.maxIntents > 1_023) {
    throw new TypeError('maxIntents must be an integer in 1..1023');
  }
  const gatewayReady = JSON.parse(await readFile(options.gatewayReadyFile, 'utf8')) as {baseUrl?: string};
  if (typeof gatewayReady.baseUrl !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/u.test(gatewayReady.baseUrl)) {
    throw new Error('gateway readiness has no loopback baseUrl');
  }
  const snapbackReady = JSON.parse(await readFile(options.readyFile, 'utf8')) as {serverUrl?: string};
  if (typeof snapbackReady.serverUrl !== 'string' || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/u.test(snapbackReady.serverUrl)) {
    throw new Error('Snapback readiness has no loopback serverUrl');
  }
  const {default: api} = await import(pathToFileURL(GENERATED_API_PATH).href) as {
    default: Record<string, unknown>;
  };
  const minted = await mintDevSession(options.readyFile, actorEmail('crew-admin'));
  const client = createExternalSessionClient(minted.baseUrl, {
    bearerToken: minted.token,
    clientStoreId: `zerobugs-lane5-worker-${process.pid}`,
    rqsStore: null,
  });
  const unsubscribeSecret = testSecret('ZERBUGS_UNSUBSCRIBE_HMAC_SECRET', 'lane5-test-unsubscribe-secret-v1');
  const loopsTransactionalID = process.env.ZERBUGS_LOOPS_TRANSACTIONAL_ID
    ?? (process.env.ZERBUGS_TEST_DEFAULTS === '1' ? 'lane5-test-transactional-v1' : '');
  if (!loopsTransactionalID) throw new Error('ZERBUGS_LOOPS_TRANSACTIONAL_ID is required');
  const report: JsonRecord = {
    schemaVersion: 'zerobugs-effect-tick.v1',
    status: 'ok',
    fault: options.fault,
    leasedIntents: 0,
    delivered: 0,
    retryable: 0,
    ambiguous: 0,
    empty: 0,
  };
  let faultUsed = false;
  try {
    for (let index = 0; index < options.maxIntents; index += 1) {
      const leasedResponse = await client.mutate(api.acceptanceLeaseNotificationIntent as never, {
        args: {now: Date.now(), leaseMs: 30_000},
        clientMutationId: `effect-lease:${process.pid}:${Date.now()}:${index}`,
        queue: false,
      });
      if (leasedResponse.result === null) break;
      const lease = record(leasedResponse.result, 'effect lease');
      const intent = record(lease.intent, 'effect intent') as IntentSnapshot;
      const attempts = Array.isArray(lease.attempts)
        ? lease.attempts.map((entry, attemptIndex) => record(entry, `effect attempt ${attemptIndex}`))
        : [];
      report.leasedIntents = Number(report.leasedIntents) + 1;
      if (attempts.length === 0) {
        report.empty = Number(report.empty) + 1;
        continue;
      }
      const deliveries = renderIntentDeliveries(intent, {
        publicOrigin: gatewayReady.baseUrl,
        unsubscribeSecret,
        loopsTransactionalID,
        expiresAt: Math.floor(intent.created / 1_000) + 30 * 24 * 60 * 60,
      });
      for (const attempt of attempts) {
        const delivery = matchingDelivery(deliveries, attempt);
        const attemptID = String(attempt.attemptID);
        if (options.fault === 'fail-before-send' && !faultUsed) {
          faultUsed = true;
          await client.mutate(api.acceptanceSettleNotificationAttempt as never, {
            args: {
              attemptID,
              outcome: 'retryable',
              now: Date.now(),
              errorCode: 'fault-injected-before-send',
            },
            clientMutationId: `effect-settle:${attemptID}:retryable`,
            queue: false,
          });
          report.retryable = Number(report.retryable) + 1;
          continue;
        }
        try {
          const action = await client.action(api.acceptanceDeliverNotification as never, {
            args: {
              provider: delivery.provider,
              url: `${gatewayReady.baseUrl}/__capture/${delivery.provider}`,
              idempotencyKey: delivery.idempotencyKey,
              body: JSON.stringify(delivery.body),
            },
          });
          const result = record(action.result, 'delivery action result');
          if (result.ok !== true) {
            await client.mutate(api.acceptanceSettleNotificationAttempt as never, {
              args: {
                attemptID,
                outcome: 'retryable',
                now: Date.now(),
                errorCode: `provider-status-${String(result.status)}`,
              },
              clientMutationId: `effect-settle:${attemptID}:retryable`,
              queue: false,
            });
            report.retryable = Number(report.retryable) + 1;
            continue;
          }
          if (options.fault === 'fail-after-send-before-receipt' && !faultUsed) {
            faultUsed = true;
            await client.mutate(api.acceptanceSettleNotificationAttempt as never, {
              args: {
                attemptID,
                outcome: 'ambiguous',
                now: Date.now(),
                errorCode: 'fault-injected-after-send-before-receipt',
              },
              clientMutationId: `effect-settle:${attemptID}:ambiguous`,
              queue: false,
            });
            report.ambiguous = Number(report.ambiguous) + 1;
            continue;
          }
          let receiptID: string;
          try {
            const parsed = JSON.parse(String(result.bodyText)) as {receiptID?: string};
            if (typeof parsed.receiptID !== 'string' || !/^zbr_[0-9a-f]{32}$/u.test(parsed.receiptID)) {
              throw new Error('capture response has no stable receipt');
            }
            receiptID = parsed.receiptID;
          } catch {
            await client.mutate(api.acceptanceSettleNotificationAttempt as never, {
              args: {
                attemptID,
                outcome: 'ambiguous',
                now: Date.now(),
                errorCode: 'provider-response-unreadable-after-send',
              },
              clientMutationId: `effect-settle:${attemptID}:ambiguous`,
              queue: false,
            });
            report.ambiguous = Number(report.ambiguous) + 1;
            continue;
          }
          await client.mutate(api.acceptanceSettleNotificationAttempt as never, {
            args: {
              attemptID,
              outcome: 'delivered',
              now: Date.now(),
              providerReceiptID: receiptID,
            },
            clientMutationId: `effect-settle:${attemptID}:delivered`,
            queue: false,
          });
          report.delivered = Number(report.delivered) + 1;
        } catch {
          // Once an action has been dispatched, a transport exception cannot
          // prove whether the provider accepted it. Fence it as ambiguous.
          await client.mutate(api.acceptanceSettleNotificationAttempt as never, {
            args: {
              attemptID,
              outcome: 'ambiguous',
              now: Date.now(),
              errorCode: 'action-dispatch-outcome-unknown',
            },
            clientMutationId: `effect-settle:${attemptID}:ambiguous`,
            queue: false,
          });
          report.ambiguous = Number(report.ambiguous) + 1;
        }
      }
      if (faultUsed) break;
    }
  } finally {
    await client.closeAuth();
  }
  return report;
}

if (import.meta.main) {
  const report = await deliverTick({
    readyFile: resolve(process.env.SNAPBACK_READY_FILE ?? DEFAULT_READY_FILE),
    gatewayReadyFile: resolve(process.env.ZERBUGS_GATEWAY_READY_FILE ?? DEFAULT_GATEWAY_READY_FILE),
    fault: requestedFault(Bun.argv.slice(2)),
    maxIntents: Number(process.env.ZERBUGS_EFFECT_MAX_INTENTS ?? '128'),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
