# Support or explicitly refuse agent authority in Contract

**Status:** Open
**Severity:** P2
**Systems:** Agent auth, Contract adapter, Client store, Guide
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay
**Marker:** product-integrity, documentation

`SnapbackClient` treats `AgentAuthorityFence` as valid auth-client protocol-v1
custody, but `@snapback/contract` resolves only `client.authCoordinator` and
throws before boot when that coordinator is absent. The guide says Contract
builds on the same headless auth behavior and describes durable grant-tuple
queued replay, yet the only agent client test uses a raw mutation and never
constructs a Contract surface or durable client store.

There is also an identity-format mismatch to resolve for support: the agent
fence's `authorityKey` is the raw NUL-delimited tuple, while the client store
accepts canonical `sha256:` authority keys.

**Done when:**

- Make an explicit product decision: Contract either supports agent custody or
  its capability report and guide clearly refuse the combination.
- If supported, add an agent-compatible participant/terminal barrier and a
  canonical durable authority key without collapsing carrier generation into
  the durable replay axis.
- Integration tests construct a Contract surface with durable storage, replay
  after same-tuple token rotation, strand/delete after tuple change, and blank
  on terminal grant/token loss.
- The adapter must not silently fall back to an unfenced or browser-session
  authority model.
