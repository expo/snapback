# Reap filesystem custody lock helpers on acquisition failure

**Status:** Open
**Severity:** P1
**Systems:** Agent auth, Filesystem custody, Node, Process lifecycle
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0059 §Cross-context ownership
**Marker:** security, durability, recovery

On macOS, `/usr/bin/lockf` forks the command that actually holds the advisory
lock. If readiness and the acquisition timeout race, killing only `lockf`
leaves the Node helper waiting on its inherited stdin/stdout pipes. The lock is
released, but the orphan can keep the caller alive and leak a process per race.
Separately, a base64url nonce beginning with `-` was parsed as a Node option and
made otherwise valid acquisitions fail intermittently.

**Done when:**

- Node option parsing is terminated before the nonce argument.
- Every pre-ownership failure closes helper stdin and terminates the complete
  isolated lock process group, with a bounded wait for stdio closure.
- Normal release also has a bounded whole-group kill fallback.
- A forced acquire-after-lock/before-ready timeout proves the child exits
  promptly and a new process immediately acquires the same OS lock.
