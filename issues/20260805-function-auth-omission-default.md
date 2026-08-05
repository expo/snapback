# Function auth omission still defaults to optional-user

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Codegen, Auth, Agent authoring
**Date:** 2026-08-05
**Governing:** LLP 0172, LLP 0173
**Origin:** Follow-up split from `issues/closed/20260804-authoring-omission-defaults-widen-effects.md`

## Problem

Omitting a function's `auth` field still silently resolves to
`optional-user`. For unattended and agent-authored applications, omission is
the most likely authoring path and can therefore widen access without an
affirmative decision.

LLP 0172 defines the staged compatibility and refusal policy, while LLP 0173
defines the provenance projected into review artifacts. Both documents remain
in **Review**, so their existence is not implementation evidence and does not
close this finding.

## Proposed fix

After LLP 0172 and LLP 0173 are accepted, implement their explicit-auth and
compatibility policy together. New authoring should either require an explicit
auth choice with a stable repair diagnostic or emit review evidence that makes
the compatibility-era default impossible to overlook.

## Acceptance

- A scratch app that omits function `auth` either fails codegen with a stable,
  actionable diagnostic or produces the accepted LLP 0173 provenance record.
- JavaScript and TypeScript authoring surfaces agree on the requirement.
- Legacy artifact decoding follows an explicit, tested compatibility version.
- Guide material states the authored choice and migration path.
