# FDL round 1 failure ledger

All commands started from shell soft NOFILE 1,024, hard 1,048,576 unless a
subprocess deliberately lowered its own limit. Each item retains its category;
expected negative controls and abandoned setup do not count as green evidence.

| Attempt | Classification | Exact failure / disposition |
| --- | --- | --- |
| First regression-file write/launch | **Ours — command setup** | Used a `snapback4/` prefix while already in that directory: shell reported missing test/log paths. No test ran; the empty nested directory was removed and the command corrected. |
| [Backoff negative control](backoff-negative.log) | **Ours — deliberate mutation, expected red** | Removed only `std::thread::sleep(self.0)` from the exhaustion path. `descriptor_exhaustion_backlog_backs_off_and_recovers` failed all four child cases (spare 0/1/2/3), then its parent assertion. Accept CPU in one second: 1,000.093 / 543.976 / 598.837 / 703.394 ms; exhaustion counts: 1,979,922 / 24,216 / 24,800 / 25,296. Exit 101. Source restored before positive checks. |
| [First guide run](development-guide.log) | **Ours — corrected prose regression** | `definitions::w11_every_registered_code_quotes_its_definition`: **109 passed, 1 failed**. The longer descriptor paragraph pushed four required `E_ASSET_UNKNOWN` action/boundary facts outside the excerpt. Moved the descriptor paragraph after the asset-recovery paragraph. The [final guide](guide.log) passes **110/110**. |
| [Interrupted early suite](aborted-full-suite.log) | **Ours — premature launch, incomplete** | Started before inspecting the guide result. Stopped only this owned suite process with SIGTERM after detecting the prose regression. Exit **143**, **no full-suite summary line**. Last entered stage: package build. This attempt is neither a completed full suite nor final-source qualification. |

Both the initial [affected Rust command](affected.log) and the final-source
[direct rerun](affected-final.log) pass all eight selected targets: binary 238 passed
with four existing ignores; HTTP 5, EMFILE 5, latency 12, lifecycle 27, replay
18, token-live 16 and witness 21. The extra policy cases in integration targets
come from their shared host-limit module. No failed affected Rust test or
baseline/environmental failure occurred in either command.

The one complete final-source full suite exited **0** with the exact line
**`== 0 failure(s) in 1634 s`** ([log](full-suite.log), [exit](full-suite.exit),
[entry limits](full-suite-environment.log)). Every Rust target and doctest,
fixture check, both app typechecks, 5,768 client tests (ten skipped), and all
79 final models passed. There are **no full-suite failures** to classify as
ours, baseline or environmental. The known baseline witness race did not
occur in this run; its round-0 issue remains open.
