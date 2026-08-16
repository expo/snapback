# Migrate the Clique kit quoted excerpt to the unambiguous preview selector

**Filed:** 2026-08-17 · **Status:** Open · **Systems:** Benchmarks, Clique UI
kit, Choreography

**Related:** LLP 0201; LLP 0266; the Coterie `0.3.1-m8` compatibility landing
in `benchmarks/tools/social-messenger/choreography/choreography.mjs`

## Problem

The frozen Clique kit's `QuotedReply` excerpt defaults to
`sm-convo-quote`, while the amended contract assigns that ID to the
per-message Reply action and assigns `sm-convo-quote-preview` to the pressable
quoted excerpt. The `0.3.0-m8` choreography exposed the contradiction directly:
old `choreography.mjs` lines 1384 and 1391 both pressed `sm-convo-quote`, first
to start a reply and then to jump from the quoted bubble to its source.

The Coterie `0.3.1-m8` landing makes the jump prefer
`sm-convo-quote-preview`, but LLP 0266 D2 forbids changing the frozen Clique
surface as part of Coterie work. The harness therefore retains a deterministic,
reply-bubble-scoped fallback to `sm-convo-quote` for `0.3.0`-era clients until
the kit can migrate under its own version.

## Closure wanted

Before the P3 freeze, change `QuotedReply`'s default excerpt test ID to
`sm-convo-quote-preview`, bump the Clique kit version, update its tests and
versioning documentation, and rerun the affected M3 choreography proof against
the migrated kit. Then remove the legacy `sm-convo-quote` jump fallback from
the choreography so that ID once again has only its per-message Reply-action
meaning when the instrument freezes.
