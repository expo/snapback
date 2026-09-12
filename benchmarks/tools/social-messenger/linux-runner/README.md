# Linux Clique launcher

These are the maintained preparation and foreground launch wrappers for future
Linux Clique run packets. They claim one fresh packet, reject occupied assigned
ports before changing run-owned files, verify the published Linux package and
frozen instrument, render the builder prompt, retain a unique preflight receipt,
and keep the builder or M7 process under an exclusive run-root lock. The packet
layout is:

```text
<run-root>/
  lanes/<wave>-<backend>/
  logs/
  prompts/
  preflight/
  scripts/{prepare.py,preflight.py,render.py,launch.py,launch_m7.py,run_support.py}
```

Prepare a new packet from this directory rather than copying scripts from a
live or retained run. On the repository checkout that supplies the reviewed
wrappers:

```sh
runner=benchmarks/tools/social-messenger/linux-runner
packet=/home/ccheever/clique-20260912-0026
install -d "$packet/scripts"
install -m 0755 "$runner/prepare.py" "$runner/preflight.py" \
  "$runner/render.py" "$runner/run_support.py" "$runner/launch.py" \
  "$runner/launch_m7.py" "$packet/scripts/"
```

Before the builder starts, the coordinator must also install the selected
frozen instrument at `instrument/`, its SHA-256 file list at
`preflight/instrument-files.sha256`, the reviewed builder template at
`prompts/template.md`, and Playwright 1.62.1 at
`preflight/playwright-1.62.1/`. These are versioned run inputs; this generic
runner deliberately does not choose them.

On `expo-build-1000`, start a newly named packet with one command. This example
uses a fresh root, a lane-private 20-port range, and an example published pin:

```sh
packet=/home/ccheever/clique-20260912-0026
published_version=0.0.26
first_port=53300
cd "$packet"
exec ./scripts/prepare.py --version "$published_version" \
  --port-start "$first_port" --port-count 20 astra snapback2
```

`prepare.py` holds one exclusive lock from the initial custody check through
the foreground builder. It refuses an existing version, rendered prompt,
builder receipt, actor metadata, or lane directory. It also refuses any
occupied assigned port before writing `SNAPBACK2_VERSION`, the rendered prompt,
or preflight output. A successful preflight is written with exclusive creation
as `preflight/pre-builder-<pid>.json`; do not pipe it through `tee` and do not
create a shared `pre-builder.json`.

`--prepare-only` performs the same checks and preparation without starting the
builder. The subsequent direct `scripts/launch.py astra snapback2` takes the
same run-root lock. `scripts/launch_m7.py` also takes that lock, so phases cannot
overlap accidentally.

Both entry points get their child environment from `run_env()`. It removes
`CI`, `EXPO_PUBLIC_SNAPBACK_URL`, and `VITE_SNAPBACK_URL` from the
launching shell. Public client URLs outrank the project's
`.snapback/dev-url`; inheriting one can therefore send a lane to another
lane's backend. If a lane deliberately needs an explicit URL, set it inside
that lane after its owner has written `.snapback/dev-url`, then restart its
bundler. Do not export it through the shell that starts a Clique builder.

The wrappers run in the foreground. On Linux they make themselves child
subreapers before starting the actor. A detached `snapback2 dev` whose
`--project` path contains `scale` is claimed only when its live process ancestry
leads to that actor (or the wrapper has adopted it) and its PID and project match
its `owner.json`. This means the actor's ordinary `npx snapback2 dev --project
replays/scale ...` launch enters custody without a special command. When a
fresh `scale-replay.json`, `scale-replay-failure.json`, or
`evidence/scale*/result.json` becomes terminal, the wrapper sends the matching
owner's authenticated stop request and verifies that the exact recorded owner
and compiler-worker process identities exited. It repeats that cleanup when the
actor exits or receives INT, TERM, or HUP. Claims and cleanup receipts are in
`logs/<wave>-<backend>[.m7].scale-owners.jsonl`; cleanup failure makes an
otherwise successful actor exit nonzero.

For old packets created before this custody existed, first list candidates and
their parentage without changing them:

```sh
ps -u "$USER" -o pid=,ppid=,etimes=,args= | awk '$0 ~ /snapback2-client-owner-|replays\/scale/ { print }'
```

Inspect the project and its `.snapback/owner.json`, use `pstree -ap <OWNER_PID>`
to identify that owner's compiler worker, and then signal only the PIDs you
explicitly selected, for example `kill -- 3113906 3113912`. Recheck those same
PIDs with `ps -p 3113906,3113912 -o pid=,ppid=,stat=,args=` before escalating an
unchanged identity to `kill -KILL -- 3113906 3113912`. Never feed the listing
pattern directly to `kill`, `pkill`, or `killall`: another packet's process or
an older ticket's process may match.

Stop the actor itself only by the PID recorded in
`logs/<wave>-<backend>.pid`. Never update the scripts inside a live or retained
packet. Install a reviewed revision into the next fresh packet.
