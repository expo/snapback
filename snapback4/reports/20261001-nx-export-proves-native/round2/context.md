# NX round 2 context

Scope: export cache/config evaluation, simulator ownership and rollback, abandoned-run recovery, export evidence retention.

Governing context: LLP 3000 (Snapback 4 root/fence); LLP 3000.030 §5 (owned lifecycle), §8 (honest artifacts), §13 (creation evidence and simulator selection), §15 (export reuse). Current author instruction replaces §15's round-1 static implementation audit with evaluated Expo prebuild results and a conservative gate for unobserved native-file effects. No core, contract or wasm budget change.

Constraints: use only this tool's recorded simulators; hold device/project custody throughout preparation and execution; stop recorded processes only; retain exact HBC/resource/native binding; distinguish environment skips from failed proof. Report cold plus five distinct warm bundles, all negative controls, one canonical suite invocation and its unchanged result. Push/publish nothing.

Open risks: Expo introspection omits dangerous/native text mods; process death bypasses Rust Drop; simultaneous pruners need a kernel lock; a PID alone cannot establish continued process identity. Changes update existing LLP §15 and append the journal. Hand-off: none.
