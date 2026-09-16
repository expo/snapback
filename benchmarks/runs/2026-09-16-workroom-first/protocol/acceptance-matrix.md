# Workroom acceptance inventory — draft for freeze

This inventory is grader-side, outside the builder packet. It itemizes the
public brief's Acceptance paragraphs without changing product requirements.
It is prepared before any pilot milestone has reported green. It is not a
test result, a frozen denominator or a score. Freeze must bind the inventory
and its evidence policy along with the public brief; the independent grader
then records pass/fail/not-run for every row, including unimplemented work.

Each grouped row requires every named subcase. Keep subcase outcomes visible;
do not award a grouped pass from one example. The brief's milestone bodies,
global rulings and fixture contract still govern even where not repeated
below. The detailed W3/W5 qualification checklist supplies the relevant
restart, state-comparison and transport-fault choreography.

| ID | Required observation |
| --- | --- |
| W1.1 | Second account cannot read the first account's organization through the API. |
| W1.2 | Owner can change roles; member cannot. |
| W1.3 | Removing membership revokes access immediately. |
| W1.4 | Organization creator is its owner. |
| W2.1 | Status and assignee filtering is performed by the backend. |
| W2.2 | Due-date sorting is performed by the backend. |
| W2.3 | Pagination is performed by the backend, without client fetch-all. |
| W2.4 | Invalid status transition is refused with a diagnosable error. |
| W2.5 | Archived task leaves default lists and remains reachable from project history. |
| W3.1 | Actual email arrives with a working acceptance token. |
| W3.2 | Accepted token cannot create a second acceptance effect. |
| W3.3 | Expired token is refused under server time. |
| W3.4 | Revoked token is refused. |
| W3.5 | Different account cannot accept the invited address's token. |
| W3.6 | Membership and audit entry are atomic; no half-applied invitation. |
| W3.7 | Duplicate acceptance is harmless in actual durable state. |
| W4.1 | Non-member cannot download attachment by URL or ID. |
| W4.2 | Extraction occurs in background and its actual state is shown on the task. |
| W4.3 | Deleted attachment bytes are unreachable by previously held URLs. |
| W4.4 | Interrupted upload leaves no visible attachment. |
| W4.5 | Interrupted upload leaves no orphan bytes after the declared cleanup window. |
| W5.1 | Wrongly signed and unsigned deliveries are rejected, with required intermediate unchanged-state observations. |
| W5.2 | Duplicate valid delivery does not apply twice. |
| W5.3 | Out-of-order delivery leaves the newer state. |
| W5.4 | Full canonical backlog after downtime applies each event effectively once. |
| W5.5 | Acknowledgement follows durable commit, verified across restart and lost response. |
| W5.6 | Seat limit refuses an invitation that would exceed capacity; reservation/acceptance semantics follow the fixture contract. |
| W6.1 | Administrative report matches the full fixture's known totals and every member row. |
| W6.2 | Report on the large organization meets its eventual frozen performance ceiling. |
| W6.3 | Audit entries cannot be edited or deleted through the API. |
| W6.4 | Reminder fires once per renewal under shortened windows. |
| W6.5 | Reminder survives backend restart without a double or missed send. |
| W6.6 | Reminder does not fire for a renewal outside the configured lead window. |
| W6.7 | Lane records how it inspected production data, the schema-change deployment experience, and yesterday-state restoration approach. |
| W7.1 | Search never includes another organization's content or an unreadable project. |
| W7.2 | Attachment-text term finds its task. |
| W7.3 | Large-organization search meets its eventual frozen performance ceiling. |
| W8.1 | Fresh-session guest change ships against live seeded data without manual data surgery. |
| W8.2 | Existing members remain unaffected. |
| W8.3 | Guest probes are refused as required by project-scoped read-only access. |
| W8.4 | A write during migration is applied or diagnostically refused, never silently lost. |

The draft inventory has 41 grouped rows. Performance rows have no passing
threshold before calibration/freeze. W8 is not attempted by the W1–W7 pilot
session. A report-only operations row does not silently introduce a hosted
deployment requirement: resolve the brief's W6/global deployment wording at
freeze and give all lanes the same wording.

Outcome O1 must disclose its final frozen denominator and unrun assertions.
O2–O5 additionally use the brief's correctness, trust, integration and scale
evidence, including the independent holdouts. Builder B1–B10 and holistic
judgment remain separate and must precede exposure to grader totals. Missing
evidence is not reconstructed from diary prose or a passing adapter boolean.
