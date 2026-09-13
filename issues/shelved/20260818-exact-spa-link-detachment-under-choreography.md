# Exact SPA link elements intermittently detach mid-navigation under automated driving

**Status:** Open
**Systems:** Exact renderer/router (fix lands in ~/projects/exact), Coterie
**Date:** 2026-08-18
**Evidence:** matrix lane sol-coterie-familiar (diary 0095): M2 suite 22/22
green but frozen choreography green=false across 4+ attempts — Playwright
found Exact SPA links repeatedly detached during routed navigation, leaving
the shared page shell unavailable for subsequent attempts; receipts
choreography-m2-attempt7/final..final4.jsonl in the retained lane. The lane
also noted Contract's link vocabulary exposes no `rel=external` full-load
opt-out, so no in-vocabulary workaround exists. NOT deterministic: the grok
(diary 0099) and opus (diary 0103) coterie-familiar lanes drove the same
frozen M2 choreography green on their own fresh Coterie implementations.

Suspects: reconciliation/repaint timing during route transitions (compare
the exact-repo caret/repaint ticket family). Wanted: a reproduction against
demos/coterie or the retained lane app, then an Exact-side fix; secondarily
a Contract decision on whether a full-load link opt-out belongs in the
vocabulary. Coordinate with the Exact repo (Linear ENG per convention) —
this repository ticket records the benchmark evidence.
