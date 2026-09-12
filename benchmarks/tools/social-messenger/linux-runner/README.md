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

The wrappers run in the foreground. Before starting the actor they create a
unique custody run ID and fingerprint any existing scale terminals; on Linux
they then make themselves child subreapers. The actor inherits the run ID.
Every M6/M8 scale-owner launch goes through the maintained executable boundary,
which creates a one-shot association sidecar and places its milestone, positive
attempt number, result path, and association identity on the owner process:

```sh
result="$PWD/evidence/scale-replay/result.json"
python ../../scripts/run_support.py scale-attempt \
  --lane "$PWD" --project "$PWD/replays/scale-m8-attempt-1" \
  --milestone M8 --attempt 1 --result "$result" -- \
  npx snapback2 dev --project "$PWD/replays/scale-m8-attempt-1" --port 53103
```

`render.py` appends this mandatory handshake to every future builder prompt.
The run ID is supplied automatically; do not override it. A retry gets a fresh
owner, incremented `CLIQUE_SCALE_ATTEMPT`, and distinct result path.
Write the normal result to an unpublished temporary path and bind it before it
becomes terminal:

```sh
python ../../scripts/run_support.py bind-result \
  --lane "$PWD" --result "$result" --source "$result.unbound"
```

The binder preserves the result's current fields and adds only the exact
sidecar identity. Launching an ordinary unassociated scale `snapback2 dev`
through the old/default path is not tolerated: custody stops that proved owner
immediately, records the diagnostic, and makes the launcher fail.

A scale owner is owned only when its live ancestry leads to the actor (or the
subreaper adopted it), its exact PID and project match `owner.json`, and a
pidfd opened for that PID still binds the same `/proc` start identity. Terminal
association additionally requires the process declaration, sidecar, and result
envelope to carry the same current run/owner/milestone/attempt identity and to
be unique. A valid result copied from another simultaneous attempt therefore
fails association. The wrapper watches only that owner's declared path. It
accepts the complete current
`snapback.full-journey-scale-replay.v1` plus digest-bound receipt,
`snapback.full-journey-scale-replay-failure.v1`, or the full raw replay report
(`pass`, start/end, actions, fixture hash, excluded probe time). Canonical final
attempt numbering must equal the declared attempt. Generic `pass`/`state`
objects, unsupported or malformed JSON, stale pre-actor bytes, and results that
predate the owner fail closed and do not stop anything. A result written before
owner discovery remains pending and is evaluated after the owner is proved.

On a matching terminal the wrapper sends only that owner's authenticated stop
request, waits on the pidfds for the exact owner and proved descendants, and
uses pidfd signals if escalation is needed. It never signals an owner or worker
by numeric PID. Actor exit or INT/TERM/HUP attempts cleanup for every proved
owner even if an earlier cleanup fails, then reports all failures together.
Claims, association decisions, and cleanup receipts are in
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
