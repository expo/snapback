# Persist agent authority custody across process restart

**Status:** Open
**Severity:** P1
**Systems:** Agent auth, Durable replay, Contract adapter
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay
**Marker:** security, durability

`AgentAuthorityFence` initializes every process at authority epoch zero and
keeps durable tuple transitions only in memory. After a tuple change, a new
process cannot bind the existing client store epoch; after a destructive
terminal result, restart can revive a tuple that should remain deleted.
Ambiguous participant writes also lack exact reread reconciliation.

**Done when:**

- Agent custody persists an exact tuple, epoch, revision, and active/deleted
  state under serialized ownership.
- Restart with the same active tuple restores its epoch and queued work;
  deleted custody cannot revive the same tuple.
- Transition/terminal writes reconcile throw-before-write and
  throw-after-write outcomes by rereading exact predecessor/target state.
- All counters fail closed at safe-integer exhaustion.
