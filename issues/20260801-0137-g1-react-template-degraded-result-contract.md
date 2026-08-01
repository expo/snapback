# 0137 G1: react template's own createTodo generates a degraded-result advisory

**Date:** 2026-08-01
**Source:** LLP 0137 Stage 1 (G1 package qualification), external-consumer smoke arm
**Finding record:** `demos/improvement-sweep/arms/g1-public-package-qualification/findings/0137-g1-f1-react-template-degraded-result-contract.json`

## Observation

A fresh external consumer's first generate warns about the scaffold itself.
With the public `@expo/snapback-*` 0.1.7 closure:

```
snapback new my-app --template react
snapback generate snapback
  ...
  degraded createTodo: functions.mjs:19:14 -> generated/api.d.ts#GeneratedApi["createTodo"]
    Add `result: results.document("table")` ... and regenerate.
```

The template's `createTodo` uses the declarative
`returns: returnBinding('todoId')` form; codegen still emits the degraded
result-contract advisory for it. First-hour experience: the paved starter
tells you to go fix the paved starter.

## Expected

An untouched `snapback new --template react` scaffold generates
advisory-clean, or the advisory recognizes that the declarative plan's
`returns` already fixes the result type.

## Proposed fix

Ship the template `createTodo` with a complete declared result contract (or
teach the degraded-contract check about `returnBinding` plans). Do not
soften the advisory itself — it is correct honesty for genuinely degraded
contracts.

## Acceptance witness

Fresh external scaffold + generate prints zero degraded advisories; a
template acceptance assertion pins it.
