# Logout immediately after an authority transition fails with `SNAPBACK_CLIENT_AUTHORITY_CLEARING`

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-explicit` (0.1.21) ·
**Systems:** Client, Auth coordinator

## Problem

A recently completed authority transition could still leave a subsequent
logout observing `SNAPBACK_CLIENT_AUTHORITY_CLEARING`. The lane worked
around it with a bounded logout retry while the coordinator finished its
prior barrier. Sign-in-then-sign-out is an ordinary sequence (and exactly
what acceptance suites do); the coordinator should serialize the logout
behind the in-flight clearing barrier itself rather than surfacing a
transient refusal for the caller to retry.

Related client-lifecycle papercut from the same run: auth-driven live-query
consumers needed an intentional remount after signin/logout to pick up the
new authority. If that is by design, the React arm should own the remount;
if not, it is a second symptom of the same transition seam.

## Evidence

- `lanes/sol-snapback-explicit/diary.md` M1 and `final-report.md`
  ("bounded logout retry during authority clearing"; "Auth-driven query
  consumers also needed an intentional remount after signin/logout").

## Suggested fix

Queue logout (and other authority operations) behind the active transition
barrier inside the coordinator, making the sequence await-able instead of
refusing. Add an acceptance-style test that performs
signin → immediate logout → signin in one process.
