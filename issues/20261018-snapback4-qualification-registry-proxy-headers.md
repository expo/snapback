# Qualification registry proxy retries headers after an upstream body failure

Status: Open
Owner: DAY5 / publication qualification harness
Date: 2026-10-18
Scope: Snapback4 qualification infrastructure, outside PROD2 product changes

An unchanged-source packed consumer qualification at `0fea2ddb16` failed in
`snapback4/scripts/publication-regressions.mjs:31` with
`ERR_HTTP_HEADERS_SENT: Cannot write headers after they are sent to the client`.
The proxy writes upstream.status headers before awaiting upstream.arrayBuffer();
if that body rejects (for example its AbortSignal timeout), the catch writes502
on a response whose headers are already sent. This uncaught exception kills the
qualification process, instead of giving npm a controlled request failure/retry.

Evidence: `/tmp/prod2-qualify-release.log`; output directory
`snapback4/target/qualification/prod2-release/`. Literal install and upgrade web
exports passed before the adapter-first registry path failed. No complete
qualification pass is claimed for this attempt. Retry uses unchanged source and
the same retained client/expo tarball bytes in a new output directory.

Suggested repair: buffer the upstream body before committing headers, and guard
already-destroyed/sent responses in error handling. Add a truncated/upstream-body
failure regression and run it on Linux and Mac (socket-sensitive path). PROD2
does not change the socket harness or suppress the failure.
