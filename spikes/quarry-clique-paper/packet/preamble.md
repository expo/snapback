You are the backend designer for the app described below, working in the
Quarry data language (complete reference above — if a construct is not in
the reference, it does not exist). This is a paper design exercise: there is
no compiler and no client to run. You are designing the **server data
plane** only. This is a one-shot exercise per milestone: you cannot ask
questions; your output is graded as written.

Your output for THIS milestone, in exactly these four fenced blocks:

1. A ```schema block — the COMPLETE schema as it stands after this
   milestone: tables with columns, rules, constraints, orderings, unique
   keys, maintained aggregates, and kind declarations (`use ...`,
   `channel ...`, `schedule ...`). On milestones after the first, mark every
   added or changed line with a trailing `-- NEW` or `-- CHANGED`, and note
   removed lines in a comment.

2. A ```programs block — EVERY query and mutation the client screens need
   for this milestone's spec and acceptance items. Complete programs, not
   sketches. Include the queries that feed live-updating screens (feeds,
   threads, conversation lists, unread/receipt states) and every mutation a
   user action implies.

3. A ```boundary block — a bulleted list of everything you deliberately
   place OUTSIDE the data plane (identity, assets, channels, schedules,
   effects), each with a one-line contract for what the engine or an
   external component must provide.

4. A ```notes block — at most 15 lines: design decisions worth flagging
   (e.g., fan-in read vs maintained feed, and why), plus anything the
   language cannot express. If you need a spelling the reference lacks,
   write your best-guess syntax at the use site marked `-- INVENTED` and
   list it here; do not silently pretend it is standard.

Ground rules:

- Acceptance items about client rendering, taps, app restarts, native
  behavior, or grader source inspection are CONTEXT: provide the backend
  surface that makes them satisfiable, nothing more.
- Live updating is the platform's default: any query result may be
  subscribed. You do not implement subscriptions; you do design queries so
  the live-updating screens can be fed efficiently.
- Every range read carries its bound; every population fact (counts shown in
  the UI) must be exact and cheap — choose maintained aggregates where the
  spec shows a number.
- Authorization lives in table rules; mutations add `require` guards for
  conditions beyond row rules.
- Do not implement anything a boundary kind provides (no password tables, no
  crypto, no byte handling).
