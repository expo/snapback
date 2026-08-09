# Clique Following feed should include the current user

**Status:** Closed
**Severity:** P3 (future benchmark product behavior)
**Systems:** Clique benchmark brief, Following feed, Follow graph
**Date:** 2026-08-09
**Resolved:** 2026-08-09
**Related:** LLP 0201

## Problem

Clique's Following-feed contract treated the explicit follow graph as the
complete set of authors whose posts should appear. As a result, a reasonable
implementation could omit a signed-in user's own posts unless a self-follow
edge happened to exist.

The product assumption is that every user implicitly follows themself. People
expect their own posts to appear alongside posts from accounts they follow;
they should not need to discover or create an explicit self-follow relationship
to get that behavior.

## Expected behavior

The Following feed includes original posts and reposts attributable to:

- the current user; and
- every user the current user explicitly follows.

Self-inclusion is a feed invariant, not a user-managed or persisted follow
relationship. It does not contribute to follower/following counts.

## Resolution

The LLP 0201 M2 summary and authoritative social-messenger brief now specify
feed-only implicit self-follow semantics. The M2 assertion manifest adds
suite-required coverage for the viewer's own original posts and reposts plus
the follower/following-count behavior.

This correction applies to future benchmark runs. The completed P2 Clique
pilot remains unchanged historical calibration evidence; its app does not need
to be retrofitted or rerun for this issue.
