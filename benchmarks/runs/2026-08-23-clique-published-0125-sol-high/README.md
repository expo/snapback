# Clique full run — published 0.1.25, Sol high

Author-requested full-scope Clique benchmark against the newly published
Snapback npm closure at **0.1.25**. The default Explicit and Familiar
TypeScript profiles each ran M1–M6 and M8 in one continuous cold session,
followed by M7 in a separate fresh session.

- **Model:** `gpt-5.6-sol`, Codex CLI 0.149.0, `high`, unsandboxed.
- **Instrument:** `social-messenger@0.3.2-m8`, manifest SHA-256
  `3438c84b8831239ab95e167eed79675a2127d7d63b3cb0f1ce72811872e2898e`.
- **Machine:** fleet entry `expo-build-450b`; endpoint hostname
  `expose-builder-pixel-a`; AMD Ryzen 5 3600 (6C/12T), 125 GiB RAM.
- **Execution:** serial, same-machine, no human steering after each prompt.
  Explicit used 48100–48159 and M7 48300–48359; Familiar used 48160–48219
  and M7 48360–48419.
- **Evidence level:** N=1 per profile, calibration/existence evidence only;
  no magnitude claim (LLP 0201 D5).

Both profiles reached web authoring-green for M1–M6, M8, and fresh-session M7.
Explicit alone completed and reconciled the 167,157-action scale replay;
Familiar recorded a capability-failure at 2,620 contiguous settlements.

Consolidated results: [record.md](./record.md). Build experience:
[Diary 0113](../../../diaries/0113-clique-published-0125-sol-high.diary.md).

Compact raw sources, prompts, event streams, reports, and receipts are retained
outside git at `/Users/ccheever/clique-published-0125-sol-high-20260823/`.
The unfiltered original remains on `expo-build-450b` at
`/home/ccheever/clique-published-0125-sol-high-20260823/`.
