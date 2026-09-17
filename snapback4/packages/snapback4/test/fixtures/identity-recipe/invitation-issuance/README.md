# Optional B1d.3 invitation issuance source

This directory is an optional source variant, not part of the baseline active
`snapback/` tree. It adds root `issueInvitation` while reusing baseline
`schema.q` and `organizations.q`. It is source and protocol-double evidence
only: no generated registry, engine, authentication, crash process or Resend
qualification has run.

## Exact future staging layout

In a disposable copy of the fixture: retain baseline `snapback/schema.q` and
`snapback/organizations.q`; create `snapback/invitation-issuance/` and copy
`issue-invitation.ts` and `resend.ts` there; append `actions.q` to staged
`snapback/schema.q`; and replace staged `snapback/server.ts` with this
directory's `server.ts`. Do not copy `actions.q` as a module, which would
incorrectly name the action `actions.issueInvitation`. The staged server
preserves `beginOidc` and `completeOidc`, adds root `issueInvitation`, and uses
`api.organizations.adminOrganizationSummary`, `invitationDeliveryState`, and
`organizationRecordInvitation`. Do not duplicate managed policy or commit
generated artifacts. The static test checks intended layout, not generation;
generated registry adoption and handler typecheck remain pending.

Preparation preflights current admin inside the durable callback before
generating 32 random bytes. Its retained outcome has the raw token, frozen
nonsecret template/config, and hash-only config/key fingerprints. Privileged
`why --values` can reveal step values and Resend receives the fragment link,
so this is not global erasure. `invite.record/v1` repeats one stable managed
write and exact-ID query before `invite.mail/v1`. Mail rechecks current admin,
exact identity, pending status, strict expiry, the ten-minute horizon and
config/key fingerprints. Historical unknown plus role loss, accepted/revoked
state, expiry, horizon or config/key change parks without another POST and
never becomes `not-sent`.

The endpoint is fixed at `https://api.resend.com/emails` and redirects are
refused. Provider acceptance is not inbox delivery. A real run separately
needs an authorized account, key, sender and quota. `delivered@resend.dev` and
plus labels are quota-consuming test simulation, not real-inbox proof. No
provider/network action ran. The frontend must take the token from the URL
fragment and submit it to the existing acceptance mutation under recipient
authentication. Cancellation or revocation cannot retract in-flight or
accepted mail.

Parked actions do not auto-resume. An operator may inspect privileged
action/provider evidence and explicitly revoke a still-pending invitation via
the existing mutation to release its reservation; unknown is never absence.

## Pending actual matrix

Future authorized engine/HTTP/process work must cut before/after
`prepare.done`; before/after invitation commit, lost ACK and replay; before
provider acceptance, after acceptance before `mail.done`, and after
`mail.done` before settlement. It must cover stable keys/changed inputs,
current role, revocation, deadline, cancellation, horizon and config fences,
ordinary result collection, default `why`/log secrecy, concurrent acceptance,
rollback and restart. Actual Resend work must distinguish API accepted, test
delivery and real inbox delivery. None ran here.
