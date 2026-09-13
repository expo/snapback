# Add a domain-neutral minimal Expo starter

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Templates, Expo, CLI, Guide, Packaging, Verification
**Date:** 2026-08-19
**Governing:** LLP 0196 portfolio/OQ1, LLP 0259, LLP 0275 D6, LLP 0294 W4

## Problem

Snapback's Expo choices are `expo-chat` and `media-feed`. They are useful
worked examples, but a generic CRUD-shaped app such as a spending tracker must
choose the right platform and delete the wrong product domain. The React/Vite
`crud-dashboard` does not solve the native carrier requirement.

LLP 0196 deliberately limits template count, so this should be a portfolio
amendment rather than an unreviewed sixth domain template.

## Required work

- Compare a distinct `expo-minimal` template with a compositional Expo shell
  shared by the two worked examples.
- Amend LLP 0196 with the selected portfolio shape and default-template ruling.
- Include only platform-owned setup: Expo provider, generated app binding,
  supervised dev, sessions-ready posture, one tiny public live read/write,
  acceptance, typecheck, and start packet.
- Do not include chat/feed schemas, screens, assets, pagination, reactions, or
  other domain code the author must delete.
- Preserve candidate-tarball and published-canary qualification.

## Acceptance

- A held-out CRUD-shaped Expo brief reaches its first product edit without
  deleting vendor-authored domain models or screens.
- Fresh scaffold → install → generate → typecheck → supervised development →
  prove passes outside the monorepo from packed packages.
- The scaffold retains honest auth, runtime-readiness, capability, and
  acceptance checks; minimal does not mean unverified.
- Template help, `create-snapback-app`, start packets, package tests, and
  inventory checks discover the new shell from one registry authority.
