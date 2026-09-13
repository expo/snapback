# Snapback 4: Client replica interpreter falls back to now for ReadTime and unknown inputs

Status: Closed
Priority: P2
Observed: 2026-09-13
Review finding: C03
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [ir.rs](../../snapback4/crates/snapback4-core/src/ir.rs), [runner.rs](../../snapback4/crates/snapback4-core/src/engine/runner.rs), retired `packages/snapback4/src/replica/interpreter.ts`

## Problem and reproduction

In the Rust IR definition (`ir.rs:157-162`), `Input` defines:

```rust
pub enum Input {
    Viewer,
    Now,
    NewId,
    ReadTime,
}
```

In the Rust execution engine (`runner.rs:380`), `Input::ReadTime` is evaluated as:
```rust
Input::ReadTime => self.context.read_time.map(Value::Int).ok_or_else(|| RuntimeError::Input("readTime is not pinned".to_owned())),
```

However, in the TypeScript client replica interpreter (`interpreter.ts:325-330`):

```typescript
case "Input": switch (body as string) {
  case "Viewer": return this.ctx.viewer;
  case "Now": return this.ctx.now;
  case "NewId": return this.ctx.newIds.shift() ?? this.ctx.mint();
  default: return this.ctx.now;
}
```

1. `Input::ReadTime` is completely omitted from the switch statement and falls through to `default: return this.ctx.now`.
2. When evaluating pinned queries on the client replica, `ReadTime` evaluates to dynamic `this.ctx.now` instead of the pinned read timestamp passed in the query context. This breaks reproducible snapshots and query replay across transactions.
3. The fallback `default: return this.ctx.now` silently converts any invalid, malformed, or future input expression variant into the current millisecond timestamp, masking schema compiler bugs and corrupting query evaluation instead of raising a descriptive `Refused` error with code `E_INPUT` or `E_SCHEMA`.

## Acceptance

- Support `ReadTime` in `interpreter.ts` and `ExecContext`, returning the pinned read timestamp or throwing `E_INPUT` if `readTime` is not set.
- Remove `default: return this.ctx.now` from `interpreter.ts`. Unhandled input variants must throw `new Refused({ code: "E_INPUT", family: "input", message: `unknown input ${body}` })`.
- Ensure parity between client interpreter and server `runner.rs` for `ReadTime`.

## Implementation locations

- Retired `packages/snapback4/src/replica/interpreter.ts` (`expr`)
- [crates/snapback4-core/src/engine/runner.rs](../../snapback4/crates/snapback4-core/src/engine/runner.rs) (`Input::ReadTime`)

## Resolution — 2026-09-13

The TypeScript replica interpreter was retired in
`993688b298d4070e549fe0c93588257964bfde05`. Native and web devices execute the
shared Rust runner, whose exhaustive `Input` match handles `ReadTime` and
returns `E_INPUT` when it is not pinned. There is no fallback that converts an
unknown input to `now`; a future enum variant must be handled before Rust will
compile. The device crate's 17 tests pass against the unified interpreter.
