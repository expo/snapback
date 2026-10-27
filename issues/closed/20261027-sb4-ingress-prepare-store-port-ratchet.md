# Neutral ingress preparation tripped the store-port ratchet

Status: Closed
Date: 2026-10-27
Resolution: SEC11L main integration; mechanical internal helper rename.

Origin/main 64e94e52cf introduced Lane::prepare calls in command_batch.rs and
program_pipeline.rs. The conservative lexical SQL guard counts `.prepare(arg)`
as database access, so its zero-production-access assertion failed for those two
files. Both emitting files and the unchanged guard were byte-identical to main
when SEC11L reproduced the failure.

Rename only the internal Lane helper/callers to `prepare_for_ingress`. Keep
ProgramCommand::prepare, backend dispatch, SQL preparation, behavior and the
ratchet rules unchanged. The final affected run rechecks the guard and core.
See LLP 3000.009.001.000 §3.4 and the SEC11L workstream report.
