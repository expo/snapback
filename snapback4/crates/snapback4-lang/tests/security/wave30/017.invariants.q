-- Independent privacy intent for Petting Zoo Parties, answered from the SPEC
-- (not copied from the rules). Checked against enforcement by
-- `snapback4 check` / `test` / `audit`.
--
-- Spec answers:
-- - A family (client) sees only its own parties.
-- - Staff (owner, desk, handler) see every party's logistics.
-- - Phone, deposit and price-per-child are visible ONLY to the booking desk
--   and the farm owner -- not to handlers and not to other clients.
-- - Only desk/owner open parties; only owner approves refunds (reason recorded).
-- - Roles are granted only by the local operator; nobody self-claims.

-- Row audience: own family plus all staff.
invariant parties.read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler']

-- Private contact/money columns: desk and owner only.
invariant parties.phone read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant parties.deposit read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant parties.pricePerChild read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']

-- Creation: the booking desk or the owner opens parties for families.
invariant parties.insert only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']

-- Updates: own family (cancel), desk/owner (manage), handlers (advance status).
invariant parties.update only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler']

-- Money/contact writes: desk and owner only.
invariant parties.phone write only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant parties.deposit write only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant parties.pricePerChild write only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']

-- Refund decision writes: the farm owner only.
invariant parties.refundApproved write only exists roles[principal = viewer, role = 'owner']
invariant parties.refundReason write only exists roles[principal = viewer, role = 'owner']
invariant parties.approveRefund only exists roles[principal = viewer, role = 'owner']

-- refundApproved is deliberately tri-state (null = undecided, true = approved):
-- the owner-only column write gate still governs every non-null decision.
invariant parties always .refundApproved = null or .refundApproved != null

-- Roster: private to its owner (and the provisioning operator); granted only
-- by the operator, never self-claimed.
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'

-- Farm board counts: staff only.
invariant partyCounts.read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler']
