# main red: agent-safe publication checker vs the conversation fixture's regenerated closure

**Status:** Open
**Systems:** Packaging, Testing, React

`scripts/verify-local-proof` fails at the `agent-safe-publication-fixtures`
gate (`node --test tests/agent_safe_publication_checker_v1.mjs`) on current
main (observed at `02c481e44`, 2026-08-06 ~09:00 PDT):

- unexpected (present but not in the manifest):
  `packages/snapback-react/fixtures/conversation/app/snapback/generated/`
  `app.binding.4b670d4a…mjs`, `app.descriptor.76e3f1f4…json`,
  `contract/sendMessage.mutation.contract-meta.ts`,
  `contract/sendMessage.mutation.ts`,
  `operations/sendMessage.args.schema.json`
- missing (in the manifest but absent):
  `app.binding.84136a5e…mjs`, `app.descriptor.256bbfd3…json`

The drift matches the conversation-surface / image-send-command landings
(`c7a8b9031` LLP 0176 G2 `useSurface`, `17e7ca8ca` LLP 0180 S2 image-send +
commands admission): the fixture's generated closure gained the sendMessage
contract files and rotated its binding/descriptor digests without the
agent-safe publication manifest being reconciled in the same push.

**How to apply:** the owning G2/G3 lane regenerates/reconciles the
agent-safe publication manifest for the conversation fixture (the checker's
own self-diagnosing output above lists the exact delta) in its next push.
Filed rather than fixed here because that lane is actively landing S2/G3
work and this inventory is theirs to keep coherent (LLP 0184's close-out
found it while running the full local proof; every other executed proof gate
before this fail-fast point was green).
