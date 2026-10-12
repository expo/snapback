import type { Refusal } from "./contract.ts";
import type { evaluateLocal } from "./local-query.ts";

// @ref LLP 3000.028#3.3.1 — publication preserves the evaluator's required value deadlines.
export type LocalResult<R> = Awaited<ReturnType<typeof evaluateLocal<R>>> & { incarnation: number; authority: number; controlCurrent: (() => boolean) | undefined };

export interface Queued {
  upload?: import("./uploads.ts").UploadDependency;
  id: string;
  seq: number;
  op: string;
  args: unknown;
  new_ids: string[];
  store_id?: string;
  predicted: string[];
  predictable?: boolean;
  replay_candidate?: boolean;
  sent_seq?: number | null;
  observed_seq?: number | null;
  dispatch?: string | null;
  receipt_store?: { id?: string | null; success_seq?: number | null };
  viewer?: string;
  now?: number;
}

export interface StoreCapture {
  generation?: number;
  backend_required?: boolean;
  store_id?: string | null;
  transfer_store_id?: string | null;
  transfer_watermark?: number;
  restore_watermark?: number;
  restore_images_at?: number;
  adoption_capture?: Record<string, string | null>;
  watermark: number;
  send_revision: number;
  restore_refusal?: Refusal;
}
