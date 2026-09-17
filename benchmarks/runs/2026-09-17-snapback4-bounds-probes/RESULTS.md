# Bounds probes — raw results

Binary: published `snapback4-darwin-arm64@0.2.27` (`npm pack`), `snapback4 --version` → `snapback4 0.2.27`.
Host: the shared development Mac, loaded (other sessions running). Node 24.18.0.
Run: `cd <probe dir> && SB=/path/to/snapback4 node measure.mjs` (each dir holds `snapback/schema.q`).
Date: 2026-09-17. Counters are `Read.meter` from loopback `dev --memory`; `ms` is one loopback HTTP call unless stated.

## search/ — `SIZES=100,500,1000 node measure.mjs`

30 messages per chat; dense = every chat has 24 "coffee" hits; sparse5 = 5 chats have hits; plus 200 foreign
chats (30 newer hits each) the viewer cannot read. `q = 'cof'`.

```
dense    chats= 100 everywhere (1 cursor)      rows= 20 complete=true  cut=null  next=yes examined=  2400 idx=   200 probes=  100 steps=   5206 ms=7.9
dense    chats= 100 inbox (plain merge)        rows= 20 complete=true  cut=null  next=yes examined=   340 idx=     0 probes=  120 steps=    425 ms=1.8
dense    chats= 100 unscoped byWords           rows= 20 complete=false cut=null  next=no  examined=  6022 idx=     2 probes= 6022 steps=     28 ms=16.2
dense    chats= 100 two-cursor walk            found=2400 requests=122 examined=79181 incompletePages=0 toFirst20: requests=2 examined=1252 wallMs=482
sparse5  chats= 100 everywhere (1 cursor)      rows= 20 complete=true  cut=null  next=yes examined=   215 idx=   105 probes=  100 steps=    646 ms=1.7
sparse5  chats= 100 inbox (plain merge)        rows= 20 complete=true  cut=null  next=yes examined=   340 idx=     0 probes=  120 steps=    425 ms=2.8
sparse5  chats= 100 unscoped byWords           rows= 20 complete=false cut=null  next=no  examined=  6022 idx=     2 probes= 6022 steps=     28 ms=14.4
sparse5  chats= 100 two-cursor walk            found=120 requests=9 examined=702 incompletePages=0 toFirst20: requests=2 examined=171 wallMs=19
dense    chats= 500 everywhere (1 cursor)      rows= 20 complete=false cut=meter next=no  examined=  8358 idx=  1000 probes=  500 steps=  18723 ms=24.6
dense    chats= 500 inbox (plain merge)        rows= 20 complete=true  cut=null  next=yes examined=  1540 idx=     0 probes=  520 steps=   2025 ms=6.1
dense    chats= 500 unscoped byWords           rows= 20 complete=false cut=null  next=no  examined=  6022 idx=     2 probes= 6022 steps=     28 ms=17.4
dense    chats= 500 two-cursor walk            found=12000 requests=610 examined=396149 incompletePages=0 toFirst20: requests=2 examined=1252 wallMs=2276
dense    chats=1000 everywhere (1 cursor)      rows= 20 complete=false cut=meter next=no  examined=  8880 idx=  2000 probes= 1000 steps=  21767 ms=38.0
dense    chats=1000 inbox (plain merge)        rows= 20 complete=true  cut=null  next=yes examined=  3040 idx=     0 probes= 1020 steps=   4025 ms=8.9
dense    chats=1000 unscoped byWords           rows= 20 complete=false cut=null  next=no  examined=  6022 idx=     2 probes= 6022 steps=     28 ms=15.7
dense    chats=1000 two-cursor walk            found=24000 requests=1220 examined=792359 incompletePages=0 toFirst20: requests=2 examined=1252 wallMs=4533
sparse5  chats= 500 everywhere (1 cursor)      rows= 20 complete=true  cut=null  next=yes examined=   615 idx=   505 probes=  500 steps=   2246 ms=4.5
sparse5  chats= 500 inbox (plain merge)        rows= 20 complete=true  cut=null  next=yes examined=  1540 idx=     0 probes=  520 steps=   2025 ms=5.7
sparse5  chats= 500 unscoped byWords           rows= 20 complete=false cut=null  next=no  examined=  6022 idx=     2 probes= 6022 steps=     28 ms=14.9
sparse5  chats= 500 two-cursor walk            found=120 requests=25 examined=1408 incompletePages=0 toFirst20: requests=2 examined=125 wallMs=45
sparse5  chats=1000 everywhere (1 cursor)      rows= 20 complete=true  cut=null  next=yes examined=  1115 idx=  1005 probes= 1000 steps=   4246 ms=10.0
sparse5  chats=1000 inbox (plain merge)        rows= 20 complete=true  cut=null  next=yes examined=  3040 idx=     0 probes= 1020 steps=   4025 ms=7.9
sparse5  chats=1000 unscoped byWords           rows= 20 complete=false cut=null  next=no  examined=  6022 idx=     2 probes= 6022 steps=     28 ms=14.9
sparse5  chats=1000 two-cursor walk            found=120 requests=45 examined=2428 incompletePages=0 toFirst20: requests=2 examined=125 wallMs=86
```

Reading: eager matching lanes cost ≈ 24 examined per chat with hits and 1 index entry per empty chat; plain
(lazy) lanes cost ≈ 2 examined per lane plus the lane-source scan. The card's dense numbers (2,400 / 8,358 /
8,880; 79,181 / 396,149 / 792,359) reproduce exactly.

`check` on this schema: `N_WIDE_MERGE` on `everywhere` ("up to 1000 lanes, one page of 21 each — up to 21000
rows per read") and on `inbox`; `N_NEVER_COMPLETE` on `unscoped`; the two-cursor pair compiles clean.

A 600-chat dense `everywhere` under `dev`: `complete:false, cut:"meter", next:null, meter.examined=8462` — the
dev server printed nothing after the read (`banner.mjs`).

## search/ — `SIZES=100,1000 node measure-grouped.mjs` (the one-cursor grouped form)

Page shape per request: `<groups>g/<examined>ex/<C|c = complete true|false>[:cut]<+|. = next present|absent>`.

```
dense    chats= 100 grouped(one cursor): requests=6 groups=100 hitsShown=300 examinedTotal=900 maxExaminedPerRequest=180 wallMs=15
   pages: 20g/180ex/c+ 20g/180ex/c+ 20g/180ex/c+ 20g/180ex/c+ 20g/180ex/c+ 0g/0ex/C.
dense    chats=1000 grouped(one cursor): requests=51 groups=1000 hitsShown=3000 examinedTotal=9000 maxExaminedPerRequest=180 wallMs=142
sparse5  chats= 100 grouped(one cursor): requests=1 groups=5 hitsShown=15 examinedTotal=140 maxExaminedPerRequest=140 wallMs=3
   pages: 5g/140ex/c.
sparse5  chats=1000 grouped(one cursor): requests=1 groups=5 hitsShown=15 examinedTotal=1040 maxExaminedPerRequest=1040 wallMs=7
   pages: 5g/1040ex/c.
sparse50 chats= 100 grouped(one cursor): requests=3 groups=50 hitsShown=150 examinedTotal=500 maxExaminedPerRequest=200 wallMs=7
   pages: 20g/199ex/c+ 20g/200ex/c+ 10g/101ex/c.
sparse50 chats=1000 grouped(one cursor): requests=3 groups=50 hitsShown=150 examinedTotal=1400 maxExaminedPerRequest=560 wallMs=16
   pages: 20g/541ex/c+ 20g/560ex/c+ 10g/299ex/c.
```

Every non-empty page reports `complete: false` with `cut: null` — the defect isolated next.

## grouped-defect/ — `node measure.mjs`

10 chats, 6 messages each, 4 chats hold "coffee". Every walk finished; nothing was cut.

```
v1: rows=4 complete=false cut=null next=null examined=22     -- where count(messages[.roomId] matching q last 1 …) > 0
v2: rows=10 complete=false cut=null next=null examined=30    -- where count(messages[.roomId] last 1 by byRoomTime) > 0
v3: rows=10 complete=true cut=null next=null examined=30     -- no filter; nested matching `last 3` in the shape
v4: rows=10 complete=true cut=null next=null examined=50     -- no filter; nested plain `last 3` in the shape
```

## following/ — `node measure.mjs`

1,000 authors × 50 posts, `public` tables, `online only`; 60 samples after 3 warm-ups, loopback HTTP.

```
5 follows    rows=20 complete=true next=true examined=115 probes=0 steps=47 p50=2.53ms p95=12.31ms | page2 examined=115 complete=true
500 follows  rows=20 complete=true next=true examined=1540 probes=0 steps=2027 p50=5.21ms p95=6.52ms | page2 examined=1540 complete=true
1000 follows rows=20 complete=true next=true examined=3040 probes=0 steps=4027 p50=8.15ms p95=8.77ms | page2 examined=3040 complete=true
ratio p50 500/5 = 2.05x ; 1000/5 = 3.22x
```

Two repeats from this directory (load average 12–15):

```
5 follows    p50=1.85ms p95=2.16ms | 500 follows p50=4.08ms p95=4.59ms | 1000 follows p50=6.39ms p95=7.35ms | ratio p50 500/5 = 2.20x ; 1000/5 = 3.45x
5 follows    p50=1.79ms p95=2.21ms | 500 follows p50=4.15ms p95=4.60ms | 1000 follows p50=6.47ms p95=6.87ms | ratio p50 500/5 = 2.32x ; 1000/5 = 3.62x
```

The first run's 5-follow p95 is host noise (one slow sample); compare p50s. `check` on this schema: `N_WIDE_MERGE` "read cost
grows with the number of related principals (up to 1001 lanes)… for Following, `snapback4 init --recipe feeds
--prefix feed`".

## Clique scale fixture facts (`instrument/fixtures/scale.log`, 167,159 lines)

- 99,090 `send` actions; **every one contains the word "coffee"**.
- 1,000 conversations. `u0001` is a member of all 1,000 (900 DMs, busy group g0001, 99 probe groups); 901 hold
  messages. All memberships exist before the `# checkpoint 10%` marker (9,999 sends so far; 49,995 at 50%).
- `u0500` is the probe user: 500 follows, 100 conversations. `u0001` follows 5.
- 0.2.27 builder's own curve: global-search p95 8.229 / 7.940 / 7.316 ms at 10 / 50 / 100% — flat; the "midpoint
  predicate" failed by 0.12 ms against a downward-sloping line.

## merge-equal-suffix-skip/ — `node measure.mjs` (an EXISTING defect, found by both blind reviewers of the B3 design, confirmed here)

`unique byRoomAt: roomId, at` (total-unique, does not end in `id`), `read <- allow`, two fixed lanes, `last 1`.
Rooms r1 and r2 each hold a row at `at = 100`.

```
page 1: ["r1-100"] complete=true next=yes
page 2: ["r1-090"] complete=true next=yes
page 3: ["r2-080"] complete=true next=no
walk returned 3 of 4; missing: ["r2-100"]
```

The merge cursor is the index suffix after the lane prefix — `[at]` — and resumption is exclusive on it, so the
other lane's row at the same `at` is never returned. Every page says `complete: true`; `check` prints no note.
`E_CURSOR_INDEX` admits "an index ending in `id` or a unique index", which is right for one prefix and wrong across
merge lanes, where only `(prefix, suffix)` is unique.

## merge-next-after-non-uniform/ — `node measure.mjs` (an EXISTING inconsistency, same source)

A uniform merge page and a non-uniform scan (`notes first 5 by byBody`, rule `.ownerId = viewer`) in one query,
in both statement orders, in two worlds differing only in 9,000 notes hidden from the viewer.

```
--- world with 0 hidden notes:
  mergeAlone             complete=true  cut=null  next=PRESENT
  mergeThenNonUniform    complete=false cut=null  next=PRESENT  n=1
  nonUniformThenMerge    complete=false cut=null  next=absent   n=1
--- world with 9000 hidden notes:
  mergeAlone             complete=true  cut=null  next=PRESENT
  mergeThenNonUniform    complete=false cut=null  next=PRESENT  n=0
  nonUniformThenMerge    complete=false cut=null  next=absent   n=0
```

§20.3 (review round 1, lane W2R1m) says the non-uniform class withholds a merge's `next`. It does only when the
non-uniform read runs first: the merge records its page before `non_uniform` is set and `next_cursor()` does not
re-check. Within each statement order `next` is identical across the two worlds, so this pair shows no leak; it shows
the invariant is not enforced at finalization. (`n` differing across worlds is the accepted opaque-cap behaviour of a
non-uniform scan, not part of this finding.)

## merge-cursor-bypasses-cursor-index/ — `node measure.mjs` (the same defect, broader than first ticketed)

`by byRoomAt: roomId, at` — **non-unique, no `id`**. A *direct* page with a cursor over this index is refused
(`E_CURSOR_INDEX: … neither ends in id nor is unique`). The *merge* with a cursor compiles clean: merge lanes are bound
with `cursor: None` and the shared cursor is attached afterwards (`bind/program.rs:547–551`), so they never reach the
check at `:274–277`. One room holds two rows at `at = 100`:

```
page 1: ["r1-100-b"] complete=true next=yes
page 2: ["r1-090"] complete=true next=no
walk returned 2 of 3; missing: ["r1-100-a"]
```

A row is skipped inside a single lane. No tie across lanes is needed.

## grouped-search-9000/ — `node measure.mjs` (why the windowed continuation, "O", is not needed)

9,000 memberships, hits in chats 4100, 8500 and 8950 only; one cursor, no merge, no second query:
`members[viewer] after c first 20 by byPrincipalRoom where count(messages[.roomId] matching q last 1 …) > 0 { roomId, hits: … last 3 }`

```
request 1: groups=1 complete=false cut=meter next=yes examined=8194 idx=8192
request 2: groups=2 complete=false cut=null next=no examined=827 idx=817
9000 chats, hits in chats 4100, 8500, 8950: found ["r04100","r08500","r08950"] in 2 requests
```

The first request is cut by the meter and still carries `next`: a filtered page's cut has positioned after its last
rule-visible examined row since wave 3 (LLP 3000.007 §5.6). The walk finishes by following one cursor. The last page's
`complete: false, cut: null` is the predicate-overflow defect (`grouped-defect/`), not an incompleteness.
