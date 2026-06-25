# Agent Instructions

This project uses **Linked Literate Programming (LLP)**. The upstream LLP
workflow is maintained at <https://github.com/ccheever/llp>; this repository
keeps its own LLP corpus under [`llp/`](./llp/).

## LLP documents

- LLP documents live in `llp/` and follow the numbering convention
  `NNNN-slug.type.md`, for example `0001-storage-decision.rfc.md`.
- The project root LLP is
  [`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md).
- When creating a new LLP, use the next available number and include the
  standard metadata header: `Type`, `Status`, `Systems`, `Author`, `Date`,
  `Revised`, and `Related`.
- Standard types: **RFC**, **Spec**, **Decision**, **Plan**, **Explainer**,
  **Principles**, **Guide**, **Issue**, and **Research**.
- Proposal statuses for RFCs, Specs, and Plans are **Draft**, **Review**,
  **Accepted**, **Implemented**, **Superseded**, **Shelved**, and
  **Withdrawn**. Explanatory documents usually use **Draft** or **Active**.
- LLP documents are living documents. Update them when the system evolves; move
  historical-but-useful documents to `llp/tombstones/` and mark them
  `Tombstoned`.

## @ref annotations

- When writing or modifying code that implements a non-obvious design decision
  documented in an LLP, add an `@ref` annotation:
  `// @ref LLP NNNN#section — short gloss`.
- When modifying code that already carries an `@ref`, check that the referenced
  section still applies. Update or remove it if it does not.
- Do not annotate mechanically. A reference should tell the reader something
  they would not know from the code and filename alone.
- Run `./ref-check --verbose` to validate references and metadata. CI runs the
  same check on pushes and pull requests.

## Agent skills

<!-- BEGIN LLP SKILLS MANAGED BLOCK -->
Before editing a subsystem with documented design, orient first: read its
governing LLP, and for non-trivial work invoke `llp-orient` to assemble a
context pack of the constraints the change must respect.

Skills: orient = context before coding; create = author one LLP; review = LLP
review loop scaled to stakes; adopt = set up LLP in any repo; maintain = drift,
pre-PR, reconcile, and retirement checks.
<!-- END LLP SKILLS MANAGED BLOCK -->

## Working on this project

- Read relevant LLP documents before implementing features or fixing bugs in
  the areas they cover.
- If you make a design decision worth preserving, write or update an LLP for it.
- Prefer updating an existing LLP over creating a new one when the topic is
  already covered.
- Land doc updates in the same commit as the code change that motivated them.
