# Verify generated-authority-operation markers by recomputation at activation

**Filed:** 2026-08-16 · **Source:** LLP 0240 B2a delta review (codex
gpt-5.6-sol xhigh, IN-DELTA MATERIAL, adjudicated fix-forward) ·
**Systems:** Runtime, Manifest, Code generation, Security/authorization

**Related:** LLP 0240 D2/D3, the B2a landing (generated authority surface),
grok delta counter-analysis (deployment-content trust plane)

## Problem

`generatedAuthorityOperation` (the manifest marker gating id-addressed
authority marshalling and `authorityTransitions` receipt exposure) is verified
for self-consistency at load (name/kind/profile dependence) but not bound to a
recomputation of the operation's generated implementation identity. A
hand-edited `generated/` directory can therefore stamp the marker onto
modified implementation source.

Adjudication at landing: NOT an authority bypass — every id-addressed planner
still enforces caller authorization, the transition matrix, and the
exactly-one-owner commit boundary; the marker widens only the app's own API
marshalling surface to its own deployment content, the same trust plane as its
authored handlers. The guide states this nonclaim explicitly.

## What done looks like

At activation (or manifest load), recompute the expected identity of each
marked operation deterministically from the declared authority profile (names,
kinds, argument schemas, implementation hash of the synthesized body) and
refuse a marker whose implementation does not match, with a stable diagnostic.
This upgrades the marker from deployment-content trust to verified generation
identity and closes the delta-review scenario outright.
