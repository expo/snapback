# Brief: team-workspace ("Workroom")

**Status:** DRAFT — commissioned by [LLP 3000.009 §10.1](../../llp/3000.009-general-purpose-backend.rfc.md)
(author, 2026-09-15) as the online-only instrument for the
general-purpose backend program. It freezes when its fixture pack exists
and a pilot calibrates budgets and ceilings. Until freeze, no run under
it supports a claim. Run rules: [`benchmarks/protocol.md`](../protocol.md).
Controls: Convex and Supabase, under the same rules, same machine, serial.

**Design rule for this document:** the brief decides everything two
reasonable agents would otherwise build differently. The lane's remaining
decisions are backend-shaped: schema, authentication wiring, server
functions, integrations, file handling, search and reporting. Where this
brief is silent and the choice is not backend-shaped, lanes take the
simplest option and note it in the diary.

## Why this brief exists

Snapback 4's record is Clique: a local-first messenger, the application
its model was designed around. This brief measures the other thing — an
ordinary online application that never leaves the network: a
multi-tenant workspace with organizations and roles, invitations by
email, a payment provider's webhooks, attachments, an audit trail, a
scheduled reminder, an administrative report and search.

**Offline is not required anywhere.** Local-first behavior earns no
completeness credit here; a lane that adds it spends its own budget. The
question is whether a builder would choose this backend over Convex or
Supabase for work of this shape.

## The app

**Workroom**, a client-project workspace, built as a web client on the
lane's backend.

- **Organizations** are tenants. A person may belong to several. Roles:
  **owner**, **admin**, **member**. (**guest** arrives in W8.)
- **Projects** belong to an organization. **Tasks** belong to a project
  and carry a status, an assignee, a due date and a description.
  **Comments** belong to a task.
- **Attachments** belong to a task: PDFs and images, with extracted text
  feeding search.
- **Invitations** are by email address, with a token, an expiry and a
  role.
- **Plans** are per organization (`free`, `pro`, `past_due`), driven by a
  payment provider's webhooks, with a seat limit.
- **An audit log** records membership, role, plan and deletion events for
  administrators.
- **A renewal reminder** is scheduled server-side.
- **An administrative report** summarizes a whole organization.

All test content, personas, media and provider behavior come from the
fixture pack; lanes never generate test content.

## Global rulings

- **Tenancy is enforced by the backend.** Every read and write is scoped
  to an organization the caller belongs to. A UI that hides other
  organizations is not enforcement; the holdout probes test the API
  directly.
- **Roles.** Owners and admins manage members, invitations, plans and
  deletion. Members create and edit projects, tasks, comments and
  attachments. Only an owner may transfer ownership or delete an
  organization.
- **Status transitions** move only along
  `open → in-progress → blocked → done`, plus `→ cancelled` from any
  state. An invalid transition is refused by the backend with a
  diagnosable error.
- **Deletion.** Tasks are archived (soft): they leave default lists and
  remain reachable from the project's history. Attachments are deleted
  hard: after deletion the bytes are unreachable by any URL the client
  ever held.
- **Time windows** come from a config file: an invitation expires in
  **7 days**; the renewal reminder fires **3 days** before a renewal.
  Grading runs the fixture pack's **shortened-windows config** (minutes,
  not days) so expiry and scheduling are testable in minutes. Windows are
  evaluated server-side against server time; a backend that accepts
  caller-supplied timestamps for a window check fails the relevant probe.
- **Email** goes to the fixture pack's sink, which records recipient,
  subject, body and time. No real SMTP, no third-party email provider.
- **Payments** are the fixture pack's provider: it signs its webhooks
  with a shared secret, and it can be told to deliver a duplicate, to
  deliver out of order, and to replay a backlog after downtime. No real
  payment provider, no card data, no checkout UI: a plan changes because
  a webhook says so.
- **Idempotency** is by the provider's event id. Applying the same event
  twice must not change the organization twice.
- **Search** covers tasks, comments and extracted attachment text within
  the projects the viewer may read. Ranking is the platform's own;
  prefix, full-text or vector all count, and the lane records what it
  used.
- **Out of scope everywhere:** offline behavior, mobile clients, real
  SMTP or payment providers, SSO/SAML, two-factor authentication,
  per-field permissions, custom roles beyond those named, i18n,
  accessibility audits, transcoding, and any analytics beyond the
  administrative report.
- **Acceptance entrypoint:** one documented command (for example
  `npm run acceptance`) runs the scripted acceptance suite from a clean
  checkout against the running backend.
- **Deployment shape:** each lane runs its backend's **local development
  deployment** — Snapback's `dev`, Convex's local deployment, Supabase's
  local stack — so an operations loss is not mistaken for a data-plane
  one. Deployment to a hosted environment is out of scope except where
  W6 asks for it.

## Scale envelope

The scale seed is a fixture action log replayed through the application's
own write path:

| Fixture | Size |
| --- | --- |
| Organizations | 50 small, plus one large |
| The large organization | 2,000 members, 120 projects |
| Tasks | 100,000 in the large organization |
| Comments | 300,000 |
| Attachments | 5,000 (fixture PDFs and images) |
| Audit entries | 50,000 |

Performance probes (descriptive at the pilot; ceilings set at freeze):
the project task list, the administrative report, a search, a burst of
200 webhook deliveries, and the latency from an invitation's commit to
its email arriving in the sink.

## Milestones

Each milestone states its acceptance assertions. A milestone is green
when every assertion passes under the acceptance entrypoint. The
invitation journey (W3) and the webhook journey (W5) are the two the
program's increment A is measured against, so they are specified first
in the fixture pack.

### W1 — Accounts, organizations and roles

Sign-up and sign-in with the platform's own authentication; create an
organization; invite-free membership for the creator as owner; list the
organizations a person belongs to; change a member's role; remove a
member.

*Acceptance:* a second account cannot read the first's organization
through the API; an owner can change roles and a member cannot; removing
a member revokes their access immediately; the creator is the owner.

### W2 — Projects and tasks

Create, edit and archive projects and tasks; assign a task; set a due
date; comment on a task; a task list shaped by the backend (filter by
status and assignee, sort by due date, paginate).

*Acceptance:* filtering, sorting and pagination happen in the backend,
not by fetching everything; an invalid status transition is refused with
a diagnosable error; an archived task leaves the default list and
remains in the project's history.

### W3 — Invitations by email

Invite an email address with a role; the invitation email arrives in the
sink with an accept link; accepting creates the membership; an
invitation expires; an owner revokes a pending invitation; re-inviting
the same address does not create a second membership.

*Acceptance:* the email arrives with a working token; the token cannot
be used twice, after expiry, or after revocation; acceptance by a
different account than the invited address is refused; the membership
and the audit entry appear in the same state (no half-applied
invitation); a duplicate accept is harmless.

### W4 — Attachments

Attach PDFs and images to a task (≤ 10 MB); download them under the same
authorization as the task; extract text from an attachment through the
fixture extractor and make it searchable; delete an attachment.

*Acceptance:* a non-member cannot download by URL or id; extraction
happens in the background and the task shows its state; after deletion
the bytes are unreachable; an upload interrupted before completion
leaves no visible attachment and no orphaned bytes after the stated
cleanup window.

### W5 — Billing webhooks and seat limits

Receive the provider's signed webhooks; move an organization between
`free`, `pro` and `past_due`; enforce the plan's seat limit when
inviting and accepting; restrict writes while `past_due` (reads and
billing updates still work).

*Acceptance:* an unsigned or wrongly signed delivery is rejected; a
duplicate delivery does not apply twice; an out-of-order pair leaves the
organization in the newer state; a replayed backlog after downtime
applies each event once; the provider is acknowledged only after the
change is durable (the fixture's provider retries until acknowledged and
reports duplicates); a seat limit refuses the invitation that would
exceed it.

### W6 — Audit log, the administrative report, and operations

An append-only audit log of membership, role, plan and deletion events,
readable by admins and never by members; an administrative report for
the whole organization (per-member open and overdue task counts, plus
attachment bytes) over the scale seed, exportable as CSV; a scheduled
renewal reminder that emails owners three days before renewal, once per
renewal.

*Acceptance:* the report matches the seed's known totals; it answers
within the pilot-calibrated ceiling on the large organization; audit
entries cannot be edited or deleted through the API; the reminder fires
once per renewal under the shortened config, survives a backend restart
(no double send, no missed send), and does not fire for organizations
whose renewal is further out. The lane also records: how it inspected
production data, what a deployment of a schema change looked like, and
what it would do to restore yesterday's state.

### W7 — Search

Search tasks, comments and extracted attachment text within the
viewer's projects, from one input, with the backend doing the work.

*Acceptance:* results never include another organization's content or a
project the viewer cannot read; a term matching attachment text finds
its task; search on the large organization answers within the
pilot-calibrated ceiling.

### W8 — Day-2 evolution (fresh session)

In a **fresh session on the finished application**, add a **guest**
role: a guest sees only the projects it is explicitly added to, cannot
see the organization's other projects, cannot invite, and appears in the
audit log. Backfill existing memberships so that nothing changes for
them.

*Acceptance:* the change ships against live seeded data without manual
data surgery; existing members are unaffected; a guest's probes are
refused; a write submitted during the migration is either applied or
refused with a diagnosable error, never silently lost.

## Holdout probes

Run by the grader, never shown to the lane:

1. Read another organization's project, task, comment and attachment by
   id.
2. Reuse an invitation token after acceptance, after expiry and after
   revocation.
3. Post a webhook with a wrong signature, and replay a valid one.
4. Download an attachment after its task is archived and after the
   attachment is deleted.
5. Write while `past_due`.
6. Read the audit log as a member; edit it as an admin.
7. After W8: read a non-member project as a guest; invite as a guest.

## Scoring

The two-layer shape of [`social-messenger.md`](./social-messenger.md)
applies — the grader scores outcome, the builder scores experience, and
the builder records a holistic 0–100 before seeing any total, citing two
or three concrete moments. This brief's dimensions:

**Grader-scored outcome (45)**

| Dimension | Weight | What it reads |
| --- | ---: | --- |
| O1 Functional completeness | 13 | Acceptance assertions passing, every in-scope milestone in the denominator |
| O2 Correctness under grading | 8 | Severity-weighted defects beyond the checklist |
| O3 Trust boundaries | 10 | The holdout probes, especially cross-tenant reads |
| O4 Integration correctness | 8 | Duplicate, out-of-order and replayed webhooks; invitation and reminder exactly-once behavior; attachment cleanup |
| O5 Performance at the scale envelope | 6 | The probes against the frozen ceilings; absolute numbers publish as diagnostics only |

**Builder-scored experience (55)**

| Dimension | Weight | What it reads |
| --- | ---: | --- |
| B1 Schema and data model | 6 | Tenancy, roles, projects, tasks, comments, attachments |
| B2 Auth and tenancy ergonomics | 6 | Sign-in, sessions, membership rules, role checks |
| B3 Server functions and integrations | 8 | Webhooks, provider calls, secrets, retries, idempotency |
| B4 Background and scheduled work | 5 | Extraction, reminders, cleanup, inspection of failures |
| B5 Files | 5 | Upload, authorization, processing, deletion |
| B6 Search | 4 | One coherent approach over three sources |
| B7 Reporting | 5 | The administrative report at scale, and its export |
| B8 Day-2 evolution | 6 | The W8 session: declare, migrate, keep clients working |
| B9 DX, docs, setup | 6 | Zero to productive; docs findable at the point of need |
| B10 Diagnostics | 4 | Whether failures named their cause |

Anchors follow `social-messenger.md`'s convention (~30 / ~60 / ~90,
interpolated). A run with a null dimension publishes per-dimension
scores only, never a weighted total.

## Narrative artifacts

Per lane: a run diary with an entry at each milestone boundary, and a
one-to-two page closing essay comparing the backend with alternatives
the model knows, written before any metric is visible. The diary must
record every workaround, every piece of infrastructure the builder had
to invent, and every correction loop with its cause.

## Fixture pack (built before freeze)

The [version 1 fixture pack](../fixtures/team-workspace/README.md) includes:

1. An **email sink** with authenticated inspection and durable idempotent acceptance.
2. A **payment provider** signing exact raw bytes, with duplicate, reorder,
   backlog, restart and retry controls, and a provider-only plan API.
3. A **text extractor** accepting only the committed PDF/image bytes by SHA-256.
4. **Personas** and a **starter action log**, segmented per milestone, with W3
   and W5 specified first and a minimum all-verb conformance profile.
5. A streaming **scale action log**, manifest hashes and independently reduced
   known report totals; replay goes through each application's normal auth and
   writes, with persistent actual-ID bindings and authoritative receipts.
6. A **presentational React DOM UI kit** accepting values and callbacks, with
   stable test IDs and no backend, network, authentication or storage logic.

The [fixture contract](../fixtures/team-workspace/CONTRACT.md) resolves these
Draft ambiguities: comments, attachments and audit counts are per-large-org;
open report tasks are non-archived `open`, `in-progress` and `blocked` tasks;
authorized members retain attachment access through task/project history;
W1 may add already registered accounts before W3's invitation flow. Pending
invitations reserve one seat per distinct new address and release it on expiry
or revocation; acceptance rechecks the limit atomically. Guests are read-only
within explicitly granted projects. Audit totals arise from real changes,
including one owner-membership event at organization creation, never direct
audit insertion. These rulings make fixture outcomes consistent across lanes.

This pack does **not** freeze the brief. Pilot calibration, budgets and ceilings
remain outstanding; no comparison or capability claim follows from fixture tests.

## Budget caps and ceilings (placeholder — set at freeze from the pilot)

| Milestone | Wall cap | Token cap |
| --- | --- | --- |
| W1–W8 | *pilot-calibrated* | *pilot-calibrated* |

| Probe | p95 ceiling |
| --- | --- |
| *per probe* | *pilot-calibrated* |

## Lane-prompt block (placeholder — instantiated at freeze)
