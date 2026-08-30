# Effects

Effects are outside the data transaction. A mutation durably emits an outbox
row; the optional Ibex 2 runner performs I/O and may invoke a named `then`
mutation.

```ts
  emit(notify, { to: recipient!.principal, body: args.body });
```

The default development binary has no engine. `snapback2 test` records the
derived effects check as `blocked: no engine in this build`; it never claims
the queued row was sent. Use `snapback2 trace <seq>` to see the outbox row.
