# Snapback2 0.0.23 preparation and publication

This record retains the initial production dry-run qualification and the
subsequent publication of `snapback2@0.0.23`. Registry
availability is reported separately below. It makes no published-package
Clique result claim.

- Source: `24ce0e08739683fcf19e9cbcf65028921b8300c5`
- Host: Silver M5 Max, macOS arm64
- Tools: Node 24.20.0, npm 11.19.0, Rust/Cargo 1.97.0
- Command: `node scripts/publish.mjs --dry-run`
- Vanilla Hermes: commit `6badada762121682b5481b6124e6c3a991ae6046`;
  `hermesc` SHA-256
  `fa070c2feddee6968c6a5aef1c92bfb84c075be1471c4733ad0361b680d73132`;
  static runtime archive SHA-256
  `9153b23a3dfdd4a0706018fc99401269f96b43190587a52b906bdeea6928a277`.

The first attempt correctly stopped when Silver lacked `pkg-config`. After
installing the standard `pkgconf` build tool it reached the pre-pack doctor and
exposed a release-harness defect: the temporary shim snapshot had not installed
its declared TypeScript dependency, so Bun 1.4's isolated workspace layout no
longer happened to supply it. Commit `24ce0e087` installs only production,
non-optional, non-peer dependencies into that temporary snapshot before the
doctor runs. The publication self-test records the required
build → install → qualify order.

The repaired exact run exited zero in 43.2 seconds. The full-engine binary was
7,813,744 bytes, its engine-less comparison was 4,461,008 bytes, and the
image/HEIC helper was 2,147,984 bytes. Staged-tarball consumer qualification
passed doctor, guide, public exports, Todo init/check/bundle/dev/live/test/stop,
and Chat init/check/bundle/dev/test/stop. Both `npm publish --dry-run` calls
accepted the `snapback2-darwin-arm64@0.0.23` and `snapback2@0.0.23` tarballs.

The retained log is
[`production-dry-run.log.gz`](./production-dry-run.log.gz), compressed SHA-256
`e3586cab28701c8745c8fe95c382992c958228ab0bea5d169e281d07ccfa7d97`;
the uncompressed log was 15,375 bytes with SHA-256
`d93a5ae8e612c71adbcb7f2d7298029ed2170dfabe31cb1b3abcc0eb301e1ffa`.

At the end of the initial preparation, real publication was blocked on registry
authority. `npm whoami` returned
`E401` on the Apartment M1 and `ENEEDAUTH` on Silver; the only other candidate
publisher host was unreachable. Registry ownership names `ccheever`. No
artifact was published, and therefore no fresh published-pin N≥3 benchmark
was started.

## Real publication, 2026-09-11

On the author's explicit publication request, Black was reachable and
`npm whoami` identified `ccheever`. The existing clean
`/Users/ccheever/projects/snapback-s2-a` worktree was reused at
`dd629ae33ad8eaad1f8fa1c35dcc4c4f7292580f`; its Snapback2 product and publisher
sources match the initial qualified source above (metrics excluded).

`bun install --frozen-lockfile` followed by
`CARGO_BUILD_JOBS=4 node scripts/publish.mjs` exited zero at
2026-09-11 13:34:05 UTC after 394.5 seconds. Tools: Node 25.9.0, npm 11.12.1,
Bun 1.3.12, Cargo/Rust 1.97.0. Both vanilla Hermes input hashes match the
initial qualification. The full-engine binary is 7,813,744 bytes, the
engine-less comparison 4,461,024 bytes, and the image/HEIC helper 2,147,984
bytes. No engine-less publication override was used.

All four media CLI tests and every staged-tarball consumer check passed,
including both templates' effects-bearing receipts, live React round trip,
and owner shutdown. This is functional publication evidence, not a loop-budget
pass: the consumer's first doctor took 19.489 seconds and its Todo bundle
18.123 seconds. The raw timings remain retained without attributing their cause.

npm accepted both uploads under `latest`, but reported asynchronous processing.
At 13:35 UTC, public registry reads still served 0.0.22. By 13:38 UTC,
both package versions were registry-visible with `latest` at 0.0.23, and both
registry integrity values exactly matched the staged artifacts below.

Staged artifact integrity values:

- `snapback2-darwin-arm64@0.0.23`:
  `sha512-VCnSaaH1uWTsNF0qNGnTwBCSn5vUBgc5ZZFwRwhVJeEPQX+spM7gKrgSoBw94lsPku5Qhnpz2E9lVGR+C8qnaQ==`
- `snapback2@0.0.23`:
  `sha512-w33LPFytWZ3u40T+gji8onnyydPKUajwbPJ09XYZMhvhOuAl1a3C6rMQD+SJjotSwXOgLOwOuoopr0Rv9TqynA==`

The complete log is [production-publication.log.gz](./production-publication.log.gz),
compressed SHA-256 `86e23e362a8e85fc435c54cf3118c6ae792cbdc9c474494d620da11d03cce8f1`;
uncompressed length 43,473 bytes and SHA-256
`1594e65197dee3ecf1b4a429c8e1758bd2cd8db8878c3bcd9af952db8d1884dc`.
Immutable tarballs and `resume.json` remain under the reused worktree's
`snapback2/dist/npm/publish-snapback2-darwin-arm64-0.0.23/`.

### Registry-installed follow-up checks

The [first registry consumer attempt](./registry-consumer-attempt1.json)
hit `ETARGET` while using the helper's `--prefer-offline` install posture.
An early `npm exec` then cached the shim without its platform optional.
After refreshing metadata with `npm install --prefer-online` in a fresh
directory, the ordinary install included the platform package and `doctor`
reported `ok: true`, version 0.0.23, and `ibex2 + vanilla hermes` (internal
68.321 ms). The run's incomplete npx cache was repaired by a normal online
install; its subsequent doctor also passed. No cache-wide deletion was used.

The [complete registry consumer on Black](./registry-consumer-black.json)
passed installation, doctor, guide, public exports, both templates' checks,
dev/test/stop, the live React round trip, and the Chat React bundle. The Todo
React bundle alone exceeded the unchanged 30-second subprocess deadline.
The aggregate result is **failed**, not green; the earlier pre-publication
staged-tarball run remains a distinct all-green observation. A second-host
registry check is recorded separately below, without erasing this timeout.

The [same registry consumer on Silver](./registry-consumer-silver.json), using
the existing Node 24.20.0/npm 11.19.0 qualification environment, passed every
step in **11.139 seconds**. It installed `snapback2@0.0.23` by registry package
specification, not a source path or staged tarball. Doctor took 0.454 seconds,
the Todo React bundle 1.300 seconds, and the Chat React bundle 0.589 seconds.
Both template receipts passed with the full effects engine. This confirms
the published Mac release is installable and functionally qualified while
retaining Black's separate timeout observation.

## Requested Clique rerun: preflight only

The author requested the run on `expo-build-1000` (`100.65.137.99`, endpoint
hostname `expose-builder-pixel`). The previous run's builder and fresh M7
configuration was `gpt-6-astra` with `model_reasoning_effort=medium`; the
frozen instrument was `f40559f37722c79178be664a11f8a6485f1508fd`.

No benchmark session was started. This publication contains only the qualified
Darwin arm64 platform package. The pinned Ibex2 dependency
`9cbf9e62d6434b4e3f4d49eddacb337218d256a3` still unconditionally selects
`macos-static`, `-stdlib=libc++`, and Apple framework link directives when
building the Hermes engine. An engine-less Linux development binary is not
the full published runtime and was not substituted. Extending the upstream
runtime for Linux or changing the requested benchmark host requires author
direction.

A fresh `npm exec --yes --package=snapback2@0.0.23 -- snapback2 doctor --json`
on EPYC installed from the registry and exited 2 with
`snapback2: no binary package for linux-x64 (snapback2-linux-x64 is not installed)`.
This is an installation preflight, not a benchmark attempt or a scored result.

Read-only host preflight found Codex 0.154.0 authenticated on EPYC,
Node 24.13.1, Bun 1.3.14, cached Chromium, and free ports 52100–52119.
Astra routing and a real browser journey have not been execution-qualified.
The independent Claude grader was installed but unauthenticated on EPYC and
Black; grader authentication also needs rechecking before a future launch.
No prior application or findings were supplied to a builder. The future cold
packet must include the frozen instrument's sibling `lib/json-schema.mjs`.
