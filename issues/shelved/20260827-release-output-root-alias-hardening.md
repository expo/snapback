# Release output-root alias hardening remains

**Status:** Open
**Systems:** Deployment, Codegen, Testing
**Date:** 2026-08-27
**Related:** LLP 0010, LLP 0072

## Hardening routes

The clean-scaffold release fix and its follow-ups establish ordinary isolated
publication and a narrow refusal property for a nonexistent output directory
reached through a symlinked ancestor. They do not close these operator-authored
alias routes:

- descendant symlinks at `outputRoot/<backend-name>` or
  `outputRoot/.snapback` can redirect publication after the root itself has been
  admitted;
- an existing `outputRoot/<backend-name>/generated` symlink can be followed by
  `synthesizeFamiliarBootstrap` before transactional publication;
- a TOCTOU interval remains between prospective output-path canonicalization
  and `mkdirSync`, during which an admitted ancestor can be replaced or
  redirected; and
- the dirty-source exclusion is wholesale for any output directory inside the
  project, so an `outputDirectory` such as `<project>/src` can hide modified
  tracked source beneath that directory. This behavior is pre-existing at base
  `04da2f52b`; it was not introduced by the clean-scaffold release stack.

All of these require the operator to point the output root at their own source
tree, or to plant a symlink into their own source tree. They are therefore
hardening work rather than blockers for the reported defect, where an ordinary
clean scaffold was dirtied by release generation without such operator-created
aliasing.
