# Primary whole-session results

Codex input <=2.0M: 2/2 pass. Codex calls <=32: 0/2 pass. Muse input <=9M: 0/2 pass. All-guide reads after schema <=3: 0/4 pass; card-only interpretation: 1/4 pass.

| Model / idea | Phase | Calls | Input | Cached | Uncached | Wall min |
|---|---|---:|---:|---:|---:|---:|
| codex 001 | before | 43 | 2,509,328 | 2,418,560 | 90,768 | 9.55 |
| codex 001 | after | 33 | 1,631,247 | 1,559,296 | 71,951 | 9.85 |
| codex 039 | before | 39 | 2,598,576 | 2,533,504 | 65,072 | 12.23 |
| codex 039 | after | 33 | 1,911,886 | 1,853,312 | 58,574 | 8.52 |
| muse 019 | before | 103 | 11,253,619 | 10,965,796 | 287,823 | 35.47 |
| muse 019 | after | 110 | 11,173,763 | 11,019,805 | 153,958 | 18.91 |
| muse 018 | before | 92 | 9,102,138 | 8,951,211 | 150,927 | 22.62 |
| muse 018 | after | 135 | 17,541,331 | 17,332,646 | 208,685 | 29.72 |

| Model / idea | Phase | Guide total | After schema (cards + API) | .d.ts | README | Server / client ref | api.ts |
|---|---|---:|---:|---:|---:|---:|---:|
| codex 001 | before | 11 | 10 (7 + 3) | 2 | 1 | 0 / 0 | 1 |
| codex 001 | after | 15 | 13 (7 + 6) | 0 | 1 | 0 / 0 | 1 |
| codex 039 | before | 15 | 14 (10 + 4) | 2 | 1 | 1 / 0 | 1 |
| codex 039 | after | 16 | 14 (8 + 6) | 0 | 1 | 1 / 0 | 0 |
| muse 019 | before | 14 | 4 (4 + 0) | 7 | 1 | 0 / 0 | 1 |
| muse 019 | after | 13 | 10 (4 + 6) | 0 | 1 | 1 / 0 | 1 |
| muse 018 | before | 7 | 3 (2 + 1) | 8 | 1 | 0 / 0 | 1 |
| muse 018 | after | 18 | 5 (3 + 2) | 8 | 1 | 2 / 1 | 1 |

See METHOD.md for protocol and limits; verification.json records the separate Expo audit red.
