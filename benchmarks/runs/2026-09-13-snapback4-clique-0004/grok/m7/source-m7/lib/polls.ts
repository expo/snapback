export const POLL_OPTION_KEYS = ["a", "b", "c", "d"] as const;
export type PollOptionKey = (typeof POLL_OPTION_KEYS)[number];

export const POLL_OPTION_IDS = {
  a: "m7-option-a",
  b: "m7-option-b",
  c: "m7-option-c",
  d: "m7-option-d",
} as const;

export function optionIdForKey(key: PollOptionKey): string {
  return POLL_OPTION_IDS[key];
}

export function keyForOptionId(id: string): PollOptionKey | null {
  for (const key of POLL_OPTION_KEYS) {
    if (POLL_OPTION_IDS[key] === id) return key;
  }
  return null;
}

export function pollOptionsFromMessage(msg: {
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
}): { key: PollOptionKey; id: string; label: string }[] {
  const out: { key: PollOptionKey; id: string; label: string }[] = [];
  const labels: [PollOptionKey, string | null | undefined][] = [
    ["a", msg.optionA],
    ["b", msg.optionB],
    ["c", msg.optionC],
    ["d", msg.optionD],
  ];
  for (const [key, label] of labels) {
    if (label) out.push({ key, id: POLL_OPTION_IDS[key], label });
  }
  return out;
}
