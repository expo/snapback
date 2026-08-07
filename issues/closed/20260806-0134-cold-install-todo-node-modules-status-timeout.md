# LLP 0134 cold-install release proof scanned `node_modules`

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** Packaging, Scaffold, Release identity, CI
**Related:** LLP 0041, LLP 0072, LLP 0134, GitHub Actions run `31137213449`, PR #18

## Failure

The Linux public-alias closure packed all nine packages and installed them into
the external Todo starter, then failed its packaged `deploy build` proof with
`SNAPBACK_DEPLOY_SOURCE_STATUS_FAILED`. Git's source-status subprocess reached
the CLI's 15-second bound and returned no status while enumerating the
materialized package tree.

## Attribution

The Todo starter's `.gitignore` was introduced in `14e19617d5` without a
`node_modules/` entry. The React starter already carried that standard ignore.
The external cold-install release proof, also introduced in `14e19617d5`,
correctly initialized and committed a real Git repository, but npm package
materialization did not preserve either template's dotfile. The installed Todo
starter therefore had no ignore file, and its later npm install left the entire
dependency closure visible to `git status --untracked-files=all`. The expanded
nine-package production closure made the latent omission exceed the Linux
timeout. This is a first-use LLP 0134 machinery gap, not a package-content or
runtime correctness failure.

## Resolution

Both templates now ship their ignore rules under the npm-stable
`gitignore.template` carrier; `snapback new` materializes that file as
`.gitignore` and removes the carrier. The Todo starter includes
`node_modules/`, the package-owned scaffold test pins both the rule and
materialization, and the cold-install proof commits the ignore file and
requires Git to classify its installed Snapback executable as ignored before
invoking `deploy build`. Git-source failures now also report their terminating
signal and spawn error code, so a future timeout cannot collapse to an
unexplained null status.
