
import * as offline from "snapback2";
const envelope = offline.decodeDeliveryEnvelope({});
const protocol: 1 = envelope.protocol;
const sequence = envelope.seq;
const sequenceNumber: number = sequence;
const verdict = envelope.receipt.verdicts[0]!.result;
const verdictBoolean: boolean = verdict;
const encoded = offline.encodeDeliveryEnvelope(envelope);
const encodedString: string = encoded;
const error = new offline.DeliveryEnvelopeDecodeError("$", "invalid");
const typeError: TypeError = error;
const path = error.path;
const pathString: string = path;
const message: offline.DeliveryMessage = offline.decodeDeliveryMessage({});
const data: offline.WireValue = offline.expandRows(envelope);
const closure: offline.EvaluatorClosureReceipt = offline.toClosureReceipt(envelope, {});
const extent: offline.DeliveryRangeExtent = offline.deliveryRangeExtent(envelope, {}, envelope.receipt.ranges[0]!);
// @ts-expect-error a decoded verdict is boolean, not number (also rejects error-any)
const wrongVerdict: number = verdict;
// @ts-expect-error a decoded sequence is number, not boolean
const wrongSequence: boolean = sequence;
// @ts-expect-error an encoded envelope is string, not number
const wrongEncoding: number = encoded;
// @ts-expect-error the generated class path is string, not number
const wrongPath: number = path;
type IsAny<T> = 0 extends (1 & T) ? true : false;
const envelopeNotAny: IsAny<typeof envelope> = false;
const verdictNotAny: IsAny<typeof verdict> = false;
const pathNotAny: IsAny<typeof path> = false;
// @ts-expect-error IsAny must itself resolve precisely, not become error-any
const wrongIsAny: IsAny<typeof verdict> = true;

import type * as standalone from "./node_modules/snapback2/dist/offline-protocol.js";
type ProtocolExports = Pick<typeof standalone,
  "DeliveryEnvelopeDecodeError" | "decodeDeliveryEnvelope" | "decodeDeliveryMessage" |
  "encodeDeliveryEnvelope" | "expandRows" | "toClosureReceipt" | "deliveryRangeExtent">;
const rootAsStandalone: ProtocolExports = offline;
const standaloneAsRoot: Pick<typeof offline, keyof ProtocolExports> = rootAsStandalone;
const standaloneEnvelope: standalone.DeliveryEnvelopeV1 = envelope;
const rootEnvelope: offline.DeliveryEnvelopeV1 = standaloneEnvelope;
import type { QueryReceiptRequest, SubscribeReceiptRequest } from "snapback2/client";
import { journey } from "snapback2/test";
const query: QueryReceiptRequest = { receipt: true };
const subscribe: SubscribeReceiptRequest = { receipt: true, validator: "opaque" };
journey("image custody", ({ as }) => {
  as("alice", { store: "file" });
  // @ts-expect-error schema custody replaced the client option
  as("alice", { viewOnce: () => true });
});
