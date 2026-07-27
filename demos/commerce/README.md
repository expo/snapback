# commerce

`commerce` is an off-main exploratory kernel for LLP 0063's storefront and
checkout pressure slice. It exercises the part Snapback's ordinary transaction
authority can prove today: server-trusted order money and final-unit inventory
contention.

Run it with a prepared Snapback binary:

```sh
node packages/snapback-codegen/index.mjs demos/commerce/snapback
SNAPBACK_SERVER_BINARY=/path/to/snapback \
  node demos/commerce/tests/acceptance/headless.mjs
```

The headless suite creates two buyer-owned draft orders from the same immutable
product facts, races both checkouts for one inventory unit, and proves that
exactly one reservation and one payment-intent row commit. The generated
`beginCheckout` argument schema contains only `orderId`; amount, currency,
quantity, tax, and discounts are not reachable public inputs.

[`pressure-profile.v1.json`](./pressure-profile.v1.json) is the fail-closed
ledger. There is no provider call, webhook, paid projection, fulfillment,
durable worker, anonymous/SEO surface, hosted control plane, or recovery drill.
LLPs 0069–0072 remain Draft, so this branch cannot report
`commerce-payments-v1` or satisfy `STEP6.COMMERCE`.
