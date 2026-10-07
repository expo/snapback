# NI2 review record

Both initial reviews were blind, using immutable candidate
`77746bb874125249136ff089ee3d2aa8f769476b`. Coding and Codex review used
GPT-5.6-Sol at xhigh; the second review used Grok 4.6 at xhigh. Reviewers did
not run the mini, author a pilot app, or see each other's initial findings.
Full initial and follow-up transcripts are retained in the NI2 evidence
archive as `review-codex*.md` and `review-grok*.md`.

| Review | Finding | Disposition |
| --- | --- | --- |
| Codex High | Runtime readiness trusted a self-asserted proof receipt | Exact source and evidence inventories, retained native/Hermes bytes, independently parsed entitlements, UI/helper/process/video evidence and trusted qualification anchor now gate readiness. Four fabrication controls reject. |
| Codex follow-up Medium | Prior SecureStore principal could appear on the relaunch process | Only two exact event sequences are accepted. Prior state is allowed solely before the first process's reset/sign-in; canonical prior UUID, process order and both current-principal witnesses are required. Wrong-process and noncanonical UUID controls reject. |
| Grok H1 | Sticky journal failures made truthful null packets independently invalid | Marker rejection is restricted to measured/application verdicts. Truthful instrument/setup null packets retain their markers and validate. |
| Grok H2 | Committed rows could lag native rows or retain offscreen rows | Stable default viewability configuration; bounded observation convergence; M6 and independent recomputation require exact native/committed row parity. The public observe API has an actual throwing-native-module control. |
| Grok M1 | Recorder failure before launch produced an impossible startupVideo field | No-attempt records retain `startupVideo: null`. |
| Grok M2 | Schema adaptation alone did not exercise attempted launch with no helper | An actual Driver launch-failure unit test records one OS attempt, zero helper nonces and retained startup video. |

Codex's follow-up approves the runtime-proof code fix. Grok's follow-up
approves H1/H2/M1/M2 source fixes. Both explicitly leave actual evidence
qualification pending; neither review authorizes a pilot launch.

The reviewed executable source is in `c0893aba08`; the final source commit
`ca4a9e11b8eb51ce1ba85abdeb1e52a99f9a71b5` also includes the README test-command
edit already covered by its unchanged inventory. Its immutable snapshot passes
all 86 Python tests. The final device and packet evidence is reported separately.

The final retained-app execution exposed one additional null-startup video
issue. The narrow fix in `090929f7e7` leaves measured endpoint validation strict
and permits a complete decodable static tail solely for setup/instrument-null
startup captures. Codex's independent follow-up approves it without findings;
its transcript is `review-codex-startup-tail.md`. The full final Python suite
passes 87 tests. The final source and inventory are bound in the qualification
ledger; neither reviewer is credited with running the device qualification.

Grok's final follow-up also **APPROVES** the narrow startup-tail fix, with no
findings. It independently inspected the actual Convex MP4 timing (72 samples;
8.933-second movie/edit duration) and verified that endpoint relaxation is
restricted to null diagnostics, with its own cache key and no measured-path
change. It did not run a full decoder or any device qualification. Transcript:
`review-grok-startup-tail.md`. The earlier CLI attempt that returned only
narration is retained as `review-grok-startup-tail-incomplete.md` and is not
counted as review approval.
