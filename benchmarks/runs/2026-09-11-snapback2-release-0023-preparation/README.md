# Snapback2 0.0.23 publication preparation

This record binds the production dry-run qualification of the unpublished
`snapback2@0.0.23` candidate. It does not claim a registry publication or a
published-package Clique result.

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

Real publication remains blocked on registry authority. `npm whoami` returned
`E401` on the Apartment M1 and `ENEEDAUTH` on Silver; the only other candidate
publisher host was unreachable. Registry ownership names `ccheever`. No
artifact was published, and therefore no fresh published-pin N≥3 benchmark
was started.
