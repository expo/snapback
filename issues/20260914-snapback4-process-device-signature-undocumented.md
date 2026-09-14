# Snapback 4: the README names `processDevice()` without its directory argument; the bare call throws

Status: Open
Priority: P3
Date: 2026-09-14
Systems: client package (`snapback4/native` opener), README
Observed version: published `snapback4@0.2.9`
Evidence status: received builder observation, three retained attempts

## Problem

The package README mentions `processDevice()` for a Node-hosted device but never states its
signature. The Clique Astra calibration on 0.2.9 called it with no argument and got
`dataDir.replace is not a function` on `undefined`; a string and an options object also failed
with diagnostic-guided guesses (`lanes/astra-snapback4/evidence/process-device-preflight{,2,3}.txt`).
The builder gave up and used the browser device for its cold-scale proof.

## Fix

State the signature where the README first names it (`processDevice({ dir })`, or whatever it
is), make the bare call refuse with one sentence naming the argument instead of a TypeError from
inside, and add the case to the periphery tests.
