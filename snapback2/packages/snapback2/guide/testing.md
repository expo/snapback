# Testing

The seed is static data, applied as one system commit before derived checks and
authored journeys:

```ts
    messages: [],
```

Write journeys with `journey(name, async ({ as, tick, url }) => …)`. The test
verb starts a fresh isolated owner, runs all six derived check families, runs
every journey through the headless wire client, removes the test store, and
writes `.snapback/receipts/<timestamp>.json`. Zero checks cannot pass. Use
`snapback2 test --blocked "reason"` for an honest blocked receipt.
