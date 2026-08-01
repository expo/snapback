# Builder dispatch — Faceplate round 2 (Snapback arm, fresh context)

You are building a small avatar application on Snapback, from its guide
alone, as a measurement of its developer experience. You have no prior
context on this repository, and you must not acquire any beyond what
this prompt allows.

Repository: /Users/ccheever/projects/snapback-0044-l1 (a git worktree;
work on the current branch; commit nothing — the coordinator commits).
Build in `demos/upload-bakeoff/faceplate/snapback-r2/` (create it).

Allowed reading: `demos/upload-bakeoff/faceplate/README.md` (your
acceptance checklist — the eight items are your definition of done),
`guide/index.md` and any page it links (follow the guide the way its
index suggests), the packages the guide tells you to use, and the
provider-neutral GPS test instrument at
`demos/upload-bakeoff/_shared/gps-jpeg.mjs` (it builds a GPS-tagged JPEG
fixture and checks served bytes for location metadata — use it for
checklist item 4). FORBIDDEN reading, without exception: `diaries/`,
`issues/`, `llp/` (unless a guide page links a specific LLP —
then only that one), `demos/upload-bakeoff/faceplate/snapback/` (a prior
implementation you must not see), anything under
`demos/upload-bakeoff/reports/`, and other demos except where the guide
itself points you at one as documentation.

Build the Snapback arm per the checklist: a backend definition plus a
minimal headless driver (`run.mjs`) that proves each checklist item and
prints an evidence table. Use sessions mode (the checklist's "two users"
implies real authenticated identities — the guide's auth pages cover
minting test personas). If a server needs to run, boot it per the guide;
kill any stale process holding your port before blaming your code.

Measurement duties, non-negotiable:
- Start a wall clock when you create the arm directory. Record elapsed
  time at: first successful codegen, first server boot, checklist item 2
  passing, and completion.
- Keep `build-log.md` in the arm dir: every stumble AS IT HAPPENS —
  the exact command, the exact diagnostic text, what you tried, what
  worked. Never go back and clean it up; the stumbles are the data.
- Record a ceremony count: the distinct concepts you had to hold to get
  checklist item 2 passing, as a list.
- Record which package surface you used (workspace packages vs published
  0.1.8) and why.

Report (final message): the evidence table (all eight checklist items
with pass/fail + one-line evidence each), total wall-clock + the
milestone splits, the ceremony list, the package surface, and your three
biggest frictions verbatim from the log. Do not editorialize about the
platform; the log speaks.
