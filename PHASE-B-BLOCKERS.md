# Phase B semantic blockers

**Status:** Resolved. The 2026-08-16 author rulings below were implemented as
`mapping.operation` and `mapping.principals`; no Phase B semantic blocker
remains.

## Collection operation for a media command

LLP 0239 D3 binds a media command to a collection and says the paved command
may create or update the owning record, but the closed authoring example and
`MediaCommandBindingV1` requirements do not select `append` versus `replace`.
Those operations have observably different stable-item-id and retained-item
semantics under D2. Which operation must the command binding carry, and what is
the closed authoring spelling for it? Phase B must not silently hard-code
`append` for update commands or invent a new field.

## Direct-recipient principal input

LLP 0239 D4 admits active/pending direct-recipient grants only when the command
descriptor declares a principal input and the server-side mutation is
authorized to derive or validate it. The exact D3 `defineMediaCommand` grammar
has no principal-input mapping, and Phase A's normative collection selection
shape carries invocation principals separately from the named sharing plan.
What closed command field maps the principal input, and is it passthrough to
the mutation, host-only binding input, or both? The direct-recipient command
variant must remain generation-refused until that authority-bearing mapping is
specified.

---

## AUTHOR RULINGS (Charlie, 2026-08-16, relayed by orchestrator) — both blockers RESOLVED

### Ruling 3 — the binding carries an EXPLICIT REQUIRED collection operation

`defineMediaCommand`'s mapping declares `operation: "append" | "replace"`,
required, no default. `remove`/`reorder` refuse at generation. The command
inherits exactly that D2 operation's item-id/retention semantics (replace
matches retained items by asset id and preserves their ids; append allocates
from the attempt plan). No silent semantic choice anywhere; the refusal for a
missing/invalid operation is source-attributed
(`<binding>.mapping.operation`).

### Ruling 4 — define the DIRECT-RECIPIENT PRINCIPAL MAPPING now

Add the closed principal-input mapping to `defineMediaCommand` in this
rollout: a declared descriptor field naming the command input that carries
recipient principals for an active/pending direct-recipient sharing plan.
Constraints:
- closed data only — a named input mapped into the binding; no callback;
- bounded exactly like Phase A's collection-op recipients argument (1–32);
- principals are NEVER authority by assertion: the host maps them into the
  same LLP 0210/0220 owner-authorized grant state machine Phase A uses, with
  full commit-time reauthorization (parent/intent/collection/sharing/
  principal);
- selecting a direct-recipient plan WITHOUT the declared principal input
  refuses at generation, and declaring the input without a direct-recipient
  plan in the ceiling also refuses (no dangling authority inputs);
- derive the exact closed spelling consistent with the existing grammar; the
  orchestrator records this ruling as an LLP 0239 amendment and reconciles
  the amendment's example to your as-built spelling before landing.
