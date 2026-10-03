# Linux Darwin cross-check

The retained templates isolate the platform-dependent serving modules from SQLite's C cross-link requirements. Replace `REPOSITORY_ROOT` with the absolute checkout root, place the manifest at `/tmp/ct-macos-check/Cargo.toml` and the Rust source at `/tmp/ct-macos-check/src/lib.rs`, then run:

```sh
cargo check --manifest-path /tmp/ct-macos-check/Cargo.toml --tests --target aarch64-apple-darwin
rustc --edition=2024 --crate-type=cdylib --emit=metadata --target aarch64-apple-darwin snapback4/crates/snapback4/tests/qos/node_readback.rs -o /tmp/ct-node-readback.rmeta
```

The final successful compiler log is `../qualification/darwin-check-final3.log`. The addon metadata check succeeds without output. These checks validate Rust and FFI types, not linking or the Mac runtime. The report contains the native operator tests that actually execute Node and read its threads.

The shell files retain the exact local sequencing of the ABBA matrices and final qualification. Their absolute workspace and temporary paths describe this run; adjust them for reproduction. `mixed-after` means the demoted comparison, while `mixed-restored` is the final product. None of these scripts pushes or publishes.
