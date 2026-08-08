# Browser local-first public witness

A deliberately small React todo surface whose real-Chrome acceptance is the
end-to-end browser witness for the JS-arm offline slice: public
authority-independent rows retained in the default IndexedDB carrier, offline
add/toggle intents that survive a Chrome `SIGKILL`, ordered replay after a
fresh authoritative snapshot, convergence with an independent Node observer,
and truthful refusal receipts for auth-scoped queries. It is cited as witness
evidence by the `sync.offline-js-arm` row in `guide/capabilities.md` (the
guide page is `guide/sync/offline-and-retention.md`; the governing program is
LLP 0155/0129).

## Run it

```sh
cd demos/browser-local-first
bun install                 # once
bun run generate            # regenerate snapback/generated from source
bun run witness:browser     # the acceptance witness (needs a qualified
                            # Snapback runtime and system Chrome)
```

## Not claiming

Authenticated/authorized retention-replay conjunction, AuthorizedLease
custody, Parity or local mutation execution, hosted topology — see
`demo.snapback.json` `notClaiming`.
