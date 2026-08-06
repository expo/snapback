# Brief: CRUD ("field-service work orders")

**Status:** authored 2026-08-06 for LLP 0186 W1's diversification
requirement ("add one CRUD-shaped … brief so wins don't overfit to
chat"). No prior run; not yet calibrated. Scope is deliberately
comparable to `messaging.md`: five-or-so related tables, a seed, one
list-heavy screen, one detail/edit screen, and one cross-table view.

## The brief

Build a field-service work-order tracker as an Expo (Expo Router) client
on the lane's backend, with:

- **Entities:** customers, sites (each belonging to a customer),
  technicians, work orders (site, assigned technician, status, priority,
  scheduled date, description), and per-order notes with timestamps.
- **CRUD:** create, read, update, and archive (soft-delete) for work
  orders and notes; create and edit for customers and sites. Archived
  orders disappear from default lists but remain reachable from the
  customer's history.
- **List views with server-side shaping:** the main screen lists open
  work orders filtered by status and assigned technician and sorted by
  scheduled date; a customer detail screen shows that customer's sites
  and full order history. Filtering/sorting must be done by the backend
  (query, index, or view), not by fetching everything and filtering in
  the client.
- **A cross-table rollup:** a per-technician workload view (count of
  open orders by status). Whether this is a join primitive, a view, an
  aggregation query, or a maintained projection is the lane's choice —
  record what the platform offered.
- **Validated transitions:** order status moves only along
  `draft → scheduled → in-progress → done/cancelled`; an invalid
  transition must be refused by the backend with a diagnosable error,
  not silently accepted.
- **Seeded data:** a versioned, idempotent seed with at least 4
  customers, 6 sites, 3 technicians, 20 work orders across all statuses,
  and notes on several orders.
- **A fast test-persona switcher** for acting as different technicians
  (visibly labeled test seam; not production authentication, per the
  fairness rules).

Record the experience in a run diary.

## Acceptance shape

Per lane: create/edit/archive round-trips proven against the live
backend; a backend-refused invalid status transition with the error
captured; the filtered/sorted list and the customer history proven
server-shaped; the workload rollup correct against the seed; seed
idempotency (second run adds nothing).

## Notes for lane fairness

- No realtime, offline, or media requirement: this is the brief where
  conventional relational platforms (Supabase, PocketBase, raw
  Postgres+Express) should be at their most representative (LLP 0186
  OQ4, OPEN).
- Live-updating lists are welcome where the platform makes them free but
  are not required and earn no functional-completeness credit.
