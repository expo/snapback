# Guide gap: adapting Snapback to an existing provider-neutral Contract surface

**Filed:** 2026-08-16 · **Status:** Resolved 2026-08-17 · **Systems:** Snapback Guide,
Contract adapters, Exact, Coterie

**Related:** LLP 0266 D4/D7/D8; `demos/coterie/src/data/snapback-provider.ts`;
`guide/clients/contract-adapter.md`

## Problem

The Contract adapter guide teaches the generated first-party path from a
Snapback app descriptor to a Contract data manifest. Coterie starts from the
inverse constraint: an existing provider-neutral Exact declaration and digest
are already frozen, and a hand-authored Snapback adapter must implement that
surface without generating a second provider identity.

The Guide has the component recipes needed underneath that adapter (generated
headless references, stream-only live queries, `AuthCoordinator`, custody, and
assets), but it does not assemble them into this integration shape. It also
does not explain how to record a milestone subset when the shared declaration
already includes later operations, how to make those later calls fail loudly,
or how to translate Snapback diagnostic/app refusal codes into a foreign
provider declaration's runtime error names.

Coterie had to infer that design by combining four guide areas with LLP 0266
and the Exact conformance harness. The resulting adapter uses the shared Exact
manifest verbatim, keeps an M1 qualification claim beside it, refuses M2/M3,
projects built-in auth principal changes as `listSession`, and uses generated
Snapback live queries for `listProfiles` with polling fallback disabled.

## Closure wanted

Add a bounded recipe—either to the Contract adapter page or linked from it—for
implementing an already-frozen, provider-neutral `ContractDataProvider` over
Snapback. It should cover:

- preserving the foreign declaration digest and treating provider-specific
  capabilities as qualification evidence;
- composing auth principal/session observation, generated live queries, and
  asset uploads behind that seam;
- honest milestone-subset refusals when a declaration has future operations;
- mapping Snapback diagnostic and application refusal codes to the foreign
  declaration's serialized error names; and
- an event-driven two-client conformance probe with no polling above the seam.

The recipe should point out that a generic conformance runner may probe one
primary query/mutation while still validating the entire shared manifest, so
the reported operation scope must remain explicit.

## Resolution (2026-08-17)

Resolved on `guide/clients/contract-adapter.md` in “Adapt an already-frozen
provider-neutral declaration.” The bounded inverse-adapter recipe preserves the
foreign manifest digest, separates provider qualification evidence, composes
Snapback auth/live-query/asset surfaces behind `ContractDataProvider`, refuses
unqualified milestone operations, maps platform diagnostics and application
refusals to foreign serialized error names, and proves delivery with two
event-driven clients and no polling above or below the seam. It explicitly
separates whole-manifest validation from the primary operations a generic
runner behaviorally probes. Retrieval-eval case 58 and the compressed
capability row preserve discovery.
