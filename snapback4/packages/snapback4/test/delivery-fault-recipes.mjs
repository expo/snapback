// Each recipe selects a real host operation below the named awaited call.
// The census test pins this mapping; there is no default for a new await.
export const groups = {
  ordinary: [0,2,3,9,14,15,16,17,19,28,29,30,31,48,52,53,54,55,57,58,59,61,62,65,68,77,78,79,80,82,83,84,92,93,94,95,99,115,116,118,132,138],
  lookup: [1,87,88,89,90,91,100,101],
  media: [7,50,107,108,109,110,111,112,113,114,139],
  postcommit: [6],
  pending: [5,13,97,98],
  reset: [20,21],
  adoption: [22,23,24,25,122,123,124],
  probe: [4,32,33,34,35,36,121],
  follow: [37,38,39,40,41,42,43,44,45,46,47,134,135,136,137],
  replay: [69,70,71,72,73],
  recovery: [60,85,86],
  acknowledgement: [81,96],
  early: [63,64,66,67],
  exit: [49,51,56,74,75,76,102,103,104,105,106],
  legacy: [117,119,120],
  native: [125,126,127,128],
  query: [8,12],
  hold: [10,129,130,131],
  clock: [133],
  auth: [11,18,26,27],
};
export function recipe(index) {
  const matches = Object.entries(groups).filter(([,ids])=>ids.includes(index));
  if (matches.length !== 1) throw Error(`unclassified or ambiguous awaited site ${index}`);
  return matches[0][0];
}

export const required = new Set([0,1,2,6,9,11,48,55,57,58,59,60,61,62,69,70,71,72,73,74,75,76,77,78,79,84,85,86,87,88,89,90,91,92,93,94,99,100,101,102,103,104,105,106,115,116,132,138]);
export const absorbs = new Set([37,44,47,49,51,56]);
