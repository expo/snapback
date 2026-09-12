# Linux Clique launcher

These are the maintained foreground launch wrappers for future Linux Clique
run packets. They retain the builder or M7 process, its exact PID, logs, and
the reachable Codex rollout tree. The packet layout is:

```text
<run-root>/
  lanes/<wave>-<backend>/
  logs/
  prompts/
  scripts/{launch.py,launch_m7.py,run_support.py}
```

Prepare a new packet from this directory rather than copying scripts from a
live or retained run:

```sh
runner=benchmarks/tools/social-messenger/linux-runner
packet=/home/ccheever/<new-run-root>
install -d "$packet/scripts"
install -m 0755 "$runner/run_support.py" "$runner/launch.py" \
  "$runner/launch_m7.py" "$packet/scripts/"
```

Run the packet's own preflight and prompt-rendering steps before invoking
`scripts/launch.py <wave> <backend>` or
`scripts/launch_m7.py <wave> <backend>`. Those preparation steps are
packet-specific and are not maintained in this directory yet.

Both entry points get their child environment from `run_env()`. It removes
`CI`, `EXPO_PUBLIC_SNAPBACK_URL`, and `VITE_SNAPBACK_URL` from the
launching shell. Public client URLs outrank the project's
`.snapback/dev-url`; inheriting one can therefore send a lane to another
lane's backend. If a lane deliberately needs an explicit URL, set it inside
that lane after its owner has written `.snapback/dev-url`, then restart its
bundler. Do not export it through the shell that starts a Clique builder.

The wrappers run in the foreground. Stop only the PID recorded in
`logs/<wave>-<backend>.pid`; do not kill by process name or port pattern.
Never update the scripts inside a live or retained packet. Install a reviewed
revision into the next fresh packet.
