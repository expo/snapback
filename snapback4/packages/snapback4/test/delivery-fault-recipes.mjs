// Each recipe selects a real host operation below the named awaited call.
// The census test pins this mapping; there is no default for a new await.
export const groups = {
  ordinary: [0,2,3,9,14,15,16,17,19,28,29,30,31,48,52,53,54,55,57,58,59,61,62,65,68,77,78,79,80,82,83,84,92,93,94,95,99,115,117,119,133,154,162],
  lookup: [1,87,88,89,90,91,100,101],
  media: [7,50,107,108,109,110,111,112,113,114,155],
  postcommit: [6],
  pending: [5,13,97,98],
  reset: [20,21],
  adoption: [22,23,24,25,123,124,125],
  probe: [4,32,33,34,35,36,122,157],
  follow: [37,38,39,40,41,42,43,44,45,46,47,135,136,137,138,156],
  replay: [69,70,71,72,73],
  recovery: [60,85,86],
  acknowledgement: [81,96],
  early: [63,64,66,67],
  exit: [49,51,56,74,75,76,102,103,104,105,106],
  legacy: [118,120,121],
  native: [126,127,128,129],
  query: [8,12],
  queryDecode: [116],
  search: [161,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153],
  hold: [10,130,131,132],
  clock: [134],
  auth: [11,18,26,27],
  closing: [159,160],
};
// Keep the existing fixture cases attached to their semantic await after the
// shared HTTP decoder moved body I/O. The census still pins every exact ID;
// new sites have no default classification. Case 156 is the new overload pause.
export function fixtureIndex(index) {
  // IT: sync refreshes pending facts after apply, including a no-op page.
  // Its read-only queue lookup is optional to already durable write custody.
  if (index === 31) return 162;
  if (index > 31) index -= 1;
  // RH round 1: the provisional search fallback reads on the shared ledger.
  if (index === 150) return 161;
  if (index > 150) index -= 1;
  // EA round 2: close reads both custody sources before reporting unknown.
  if (index === 95 || index === 96) return index + 64;
  if (index > 96) index -= 2;
  // Round 3: the probe's admission refusal owns one paced recovery wait.
  if (index === 35) return 157;
  if (index > 35) index -= 1;
  // Round 2: auth handling precedes refusal wait; schema send/body now share
  // the safe-read await (body I/O is also exercised by readResponse).
  if (index === 41) index = 42;
  else if (index === 42) index = 41;
  if (index >= 124) index += 1;
  if (index >= 17 && index <= 40) return index + 1;
  // The shared JSON await is required: it also reads mutation receipts, where
  // failure must retain the same ID and wait for recovery before the FIFO tail.
  return ({41:156,115:12,116:115,154:116,155:117,156:154,157:155})[index] ?? index;
}
export function recipe(ordinal) {
  const index = fixtureIndex(ordinal);
  const matches = Object.entries(groups).filter(([,ids])=>ids.includes(index));
  if (matches.length !== 1) throw Error(`unclassified or ambiguous awaited site ${index}`);
  return matches[0][0];
}

export const required = new Set([0,1,2,6,9,11,48,55,57,58,59,60,61,62,69,70,71,72,73,74,75,76,77,78,79,84,85,86,87,88,89,90,91,92,93,94,99,100,101,102,103,104,105,106,115,117,133,154]);
export const absorbs = new Set([37,44,47,49,51,56]);
