# The loop bar: reduced Clique M1–M3 on Snapback 4

You are a senior product engineer building a small production-shaped app from
scratch, alone and timed. Work fully autonomously; there is no human to ask.
Work only in the current directory. Do not read any Snapback source
repository or any prior implementation on this machine.

Install and use ONLY `snapback4@{VERSION}` from the public npm registry (exact
pin: `npm install snapback4@{VERSION}`; it installs its platform binary, so
`npx snapback4` works), its README — the one installed at
`node_modules/snapback4/README.md`, which describes the version you have;
the registry page may describe a newer one — (read its first-account
orientation and reference map first), its linked client/server references and the guide it serves (`npx snapback4 guide`,
`npx snapback4 guide <keyword>`), `npx snapback4 why <CODE>`, and its
generated types (`snapback/generated/api.ts`, written by `npx snapback4
check`). The backend is authored in Quarry (`snapback/schema.q`). The client
is a React web app (Vite) on `snapback4/local` and `snapback4/react`. No
media, no Expo, no search.

## The app: Clique, reduced

Three personas: `alice`, `bob`, `carol` (`use personas alice, bob, carol`).

**M1 — Accounts and profiles.** Every persona has a profile: `handle`
(3–20 characters, unique), `displayName` (1–50), `bio` (≤160, optional).
A profile is public. A user edits only their own. The web app shows the
viewer's profile and lets them edit it.

**M2 — Posts and the follow graph.** A post has an author, `text` (1–500)
and a time. A user follows and unfollows other users (no self-follow, no
duplicate). Two feeds: *following* (posts by people the viewer follows,
newest first, paged by 20) and *global* (every post, newest first, paged by
20). Posts are public. The web app shows both feeds, a compose box, and a
follow/unfollow button on other profiles.

**M3 — Messaging core.** Conversations (DMs and groups) with memberships
(`member` or `admin`; the creator is admin). Only members read a
conversation and its messages; admins invite; anyone leaves. Messages have
an author, `body` (1–4,000) and a time; the thread pages newest-first by
50. The inbox lists the viewer's conversations with a message count. The
web app shows the inbox, a thread, a composer; a message sent on one browser
appears on another member's browser without a reload.

## The proof

1. `npx snapback4 check` reports no problems.
2. A fixture directory `fixtures/` with one `<table>.jsonl` per table (three
   profiles, a few follows, six posts, one DM and one group with messages)
   such that `npx snapback4 test --fixture fixtures --as alice` runs every
   query green and prints its meters.
3. `npm run acceptance` — your own script — starts `snapback4 dev` on a port
   of your choosing above 49500, seeds the fixture through `POST /seed`,
   exercises every operation over HTTP as each persona (`x-snapback-persona`),
   asserts the rules (a non-member reading a thread is refused; a
   self-follow is refused; a second follow is refused), and exits 0. Keep the
   child handle and PID when you launch a server, and close that child in a
   `finally` block. Do the same for development servers you launch while
   building. Never discover another process by its name, directory or port
   and kill it. If a chosen port is occupied, choose another or report the
   conflict. The runner repeats acceptance from a new copy with no dev store;
   it preserves that copy for diagnosis and does not stop unowned processes.
4. The web app builds (`npm run build`) and typechecks.

## The record

Create `run-log.md` first. Its first line is `start=<unix epoch seconds>`.
Append one timestamped line for every milestone start and green, every
error and how you resolved it, every knowledge lookup (source: model
knowledge, package README/guide, `why`, diagnostic, web), and every
correction loop with an attribution: `snapback4-defect` (the package refused
something the README says it does, or behaved wrongly), `docs-gap` (the
README or guide did not say), `agent-error`, or `environment`. When the four
proofs above pass, append `green=<unix epoch seconds>` and stop; do not
polish after green. Finish with `final-report.md`: what you built, wall
clock by milestone, each correction loop with its attribution, and a candid
gap list.
