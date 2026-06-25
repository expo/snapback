# Snapback

This repository uses Linked Literate Programming (LLP) to keep design rationale
close to the code that implements it.

LLP documents live in [`llp/`](./llp/). Start with
[`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md) for the
project-level context, then add focused LLP documents as design decisions are
made.

## LLP workflow

- Put durable design rationale in numbered LLP documents:
  `llp/NNNN-slug.type.md`.
- Add `@ref` annotations in code when a non-obvious implementation decision is
  governed by an LLP section.
- Run `./ref-check --verbose` before pushing changes that touch LLP documents
  or referenced code.
- Use the workflow skills under [`skills/`](./skills/) for orientation,
  authoring, review, adoption, and maintenance.

The LLP source project is <https://github.com/ccheever/llp>. This repository
copies the workflow files directly; it does not use LLP as a Git submodule.
