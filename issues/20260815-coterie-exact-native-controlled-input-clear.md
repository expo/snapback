# Coterie native controlled input retains text after Contract state clears

**Filed:** 2026-08-15 · **Status:** Open · **Systems:** Exact, Contract,
UIKit, Demos

**Related:** LLP 0263; Diary 0086

## Problem

In the Coterie iOS simulator run, the post action wrote `composeText = ""`
and the derived Post button became disabled, proving the Contract state had
cleared. Acto nevertheless continued to report the submitted string as the
native text input's value. Moving the write before or after the awaited
provider mutation did not change that result.

The mismatch leaves stale glyphs on screen and makes native presentation
disagree with application state. This was observed through the direct Acto
tree after a native-reachable Post tap, not inferred from a screenshot.

## Interim workaround

`demos/coterie/src/ui/composer.contract` keeps two absolutely overlaid input
identities, exposes only one test ID, marks the hidden copy inert/disabled, and
flips identities on reset. The final iOS tree then showed `value=""`, disabled
Post, and the created feed row with `Like (0)`.

The workaround is not measurement-neutral: it adds seven native presentation
nodes and Acto reports `invisible-present`, `zeroSize`, and duplicate keyboard-
avoidance warnings for the hidden copy. Remove it when the UIKit controlled-
input reconciliation path applies programmatic value resets to an input that
recently received native typing.

## Closure wanted

Add an Exact UIKit regression that types into a controlled Contract input,
handles an action that writes the bound state to empty, and proves both the
semantic state and native text value clear without recreating the node. Then
remove Coterie's identity-flip workaround and confirm its native tree returns
to the smaller baseline.
