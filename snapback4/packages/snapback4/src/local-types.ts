import type { Refusal } from "./contract.ts";

export interface Queued {
  id: string;
  seq: number;
  op: string;
  args: unknown;
  new_ids: string[];
  predicted: string[];
  predictable?: boolean;
  replay_candidate?: boolean;
  sent_seq?: number | null;
  observed_seq?: number | null;
  viewer?: string;
  now?: number;
}

export interface StoreCapture {
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

