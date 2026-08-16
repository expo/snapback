# LLP 0243 authority-profile protected-retention qualification

**Opened:** 2026-08-15 · **Source:** LLP 0240 residual closure ·
**Systems:** Protected retention, Authorization, Memberships, Client storage

## Problem

LLP 0240 now compiles strict app-owned authority-profile membership into the
ordinary query and mutation path, but that does not by itself authorize stale
private bytes on a disconnected client. The original residual's
"retained-history policy" criterion belongs to LLP 0243's separately accepted,
lease-bound protected-retention design and must not be implied by the online
handler-admission implementation.

## What done looks like

Complete LLP 0243 rollout 5 for generated plans over strict LLP 0240 scoped-role
profiles, including the full revocation, role-downgrade, user-switch, expiry,
corruption, projection-exclusion, and carrier matrices. Then complete rollout 6
by rebuilding the Clique private-chat cache and Relay Room offline preview from
a published npm closure without an app-owned protected cache.

The capability and guide GAP remain unchanged until each carrier/target passes
the LLP 0243 acceptance matrix. This ticket does not broaden the implemented
LLP 0240 online list, role, or handler-admission claims.
