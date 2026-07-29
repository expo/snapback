# Fail-closed Supabase CLI wrapper threat model

Status: this document governs the wrapper. One approved live start used its
first reviewed revision, failed closed during parsing, and was immediately
stopped and cleaned. The corrected revision described by the adjacent source
review has synthetic validation only and awaits approval before another start.

## Protected boundary

- The coordinator must create a unique parent directory that is a real
  directory, owned by the current uid, and mode `0700`. The wrapper refuses a
  missing, symlinked, differently owned, or differently permissioned parent.
- The state root must not already exist. The wrapper creates it as `0700` and
  opens child and parser stdout/stderr with exclusive, no-follow `0600` file
  descriptors. Neither process inherits or pipes provider text to the caller.
- The caller receives one fixed-schema JSON status. It contains only command
  class, exit codes, byte counts, SHA-256 hashes, booleans, and allowlisted
  key-name/presence booleans.
- Parsing runs in a separate process with redirected stdout/stderr. It accepts
  only the documented carrier assignments and aliases, explicitly ignores
  expected non-carrier URL/JWT/region assignments, and rejects every other
  assignment and every unknown credential-shaped table label.
- The parser validates the entire input before normal carrier creation.
  Carriers are exclusive `0600` files. The wrapper requires directory entries
  to equal exactly the boolean-present allowlist.
- Child failure, parser failure, unexpected keys, malformed manifests, and
  wrapper exceptions remove all carriers and raw/parser streams before the
  status is emitted. Pre-existing roots and symlink targets are never cleaned.

## Assumptions

- The kernel, local filesystem permission model, Node runtime, wrapper source,
  and parser source are trusted.
- The invoked CLI uses standard file descriptors 1 and 2 for its output and is
  not maliciously opening a terminal, sending output over the network, or
  writing secrets to unrelated files.
- Credentials are not supplied in argv or inherited environment variables.
- Other processes running as the same uid are trusted. The unique private
  parent reduces accidental collision but is not a boundary against that uid.

## Residual risks

- An uncatchable termination or host failure can leave `0600` raw files inside
  the `0700` root. Recovery must delete the exact abandoned root before reuse.
- The wrapper cannot contain provider logs written outside stdout/stderr.
- Output hashes reveal equality and should be treated as evidence metadata,
  not published as authentication material.
- The parser intentionally fails on unrecognized output. A future CLI output
  change requires a reviewed allowlist update before the arm can continue.

## Approval boundary

The corrected revision must not run a real `supabase` command until the
coordinator explicitly approves its source review and new synthetic evidence.
