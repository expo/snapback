// @ref LLP 3000.037.000#9 — reruns isolate identities as well as row names.
import { randomUUID } from "node:crypto";
/** A unique row name or intent ID for this run; does not bypass per-owner caps.
 * @throws E_PROOF_USAGE for an invalid prefix. */
export function uniqueName(prefix = "proof"): string {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(prefix)) throw Error("E_PROOF_USAGE: uniqueName prefix must be 1..32 ASCII name characters, starting with a letter");
  return `${prefix}-${randomUUID()}`;
}
/** Setup advice only; never retries a refused mutation or changes its code. */
export function capacityAdvice(text: string): string {
  return /holds at most \d+ rows/.test(text)
    ? "Proof capacity reached: a repeat run shares rows with earlier runs. Use freshUser() for a fresh owner/group and uniqueName() for row names, or deliberate authorized cleanup. Do not reset the production store or raise its cap for the proof."
    : "";
}
