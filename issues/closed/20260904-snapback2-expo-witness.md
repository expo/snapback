# Snapback 2 Expo witness needs qualification

Status: Closed

Last run: 2026-09-04T23:14:38.579Z
Failing step: 1 — build, owner seed, and outward control

```
Error: xcrun simctl list devices available --json exited 1
2026-09-04 17:14:38.524 simctl[18485:31642472] CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
2026-09-04 17:14:38.524 simctl[18485:31642474] Logging connecton invalid: <OS_xpc_error: <dictionary: 0x1fbafa080> { count = 1, transaction: 0, voucher = 0x0, contents =
	"XPCErrorDescription" => <string: 0x1fbafa1c0> { string cache = 0x0, length = 18, contents = "Connection invalid" }
}>
2026-09-04 17:14:38.525 simctl[18485:31642474] Error opening log file (/Users/ccheever/Library/Logs/CoreSimulator/CoreSimulator.com.apple.CoreSimulator.simctl.log): Operation not permitted
[-[SimServiceContext sendRequest:]:1751] ERROR : Unable to deliver request ({
    "developer_dir" = "/Applications/Xcode.app/Contents/Developer";
    request = "set_developer_dir";
}) because we are not connected to CoreSimulatorService.
[-[SimServiceContext initWithDeveloperDir:connectionType:error:]:432] WARN  : Unable to discover any Simulator runtimes. Developer Directory is /Applications/Xcode.app/Contents/Developer.
[-[SimDiskImageManager init]:175] ERROR : Could not kickstart simdiskimaged; SimDiskImageManager services will not be available: Error Domain=NSPOSIXErrorDomain Code=53 "Software caused connection abort" UserInfo={NSLocalizedDescription=Error returned in reply from CoreSimulatorService: Connection invalid}
[-[SimDiskImageManager _onQueue_checkConnection:]:239] ERROR : simdiskimaged returned error (invalid), marking disconnected.
[-[SimDiskImageManager _onQueue_checkConnection:]:239] ERROR : simdiskimaged returned error (invalid), marking disconnected.
[-[SimServiceContext initWithDeveloperDir:connectionType:error:]_block_invoke:468] ERROR : Could not get list of trusted mount directories: Error Domain=com.apple.CoreSimulator.SimError Code=410 "The service used to manage runtime disk images (simdiskimaged) crashed or is not responding" UserInfo={NSLocalizedDescription=The service used to manage runtime disk images (simdiskimaged) crashed or is not responding}
[-[SimServiceContext sendRequest:reply:error:]:1771] ERROR : Unable to deliver request ({
    request = "notification_subscription";
    "set_path" = "/Users/ccheever/Library/Developer/CoreSimulator/Devices";
}) because we are not connected to CoreSimulatorService.
2026-09-04 17:14:38.577 simctl[18485:31642469] Error Domain=NSPOSIXErrorDomain Code=61 "Connection refused" UserInfo={NSLocalizedDescription=CoreSimulatorService connection became invalid.  Simulator services will no longer be available.}
Unable to locate device set: Error Domain=NSPOSIXErrorDomain Code=61 "Connection refused" UserInfo={NSLocalizedFailureReason=Failed to subscribe to notifications from CoreSimulatorService., NSLocalizedDescription=Failed to initialize simulator device set., NSUnderlyingError=0xc42e68930 {Error Domain=NSPOSIXErrorDomain Code=61 "Connection refused" UserInfo={NSLocalizedDescription=CoreSimulatorService connection became invalid.  Simulator services will no longer be available.}}}

```

Run `cd snapback2 && node scripts/witness-expo.mjs` outside the sandbox. Success requires all ten steps; see `target/e2-witness-result.json`. Android and Expo web remain outside E2.

Schedule activation is also pending: generated six-hour launchd plist validates, but `launchctl bootstrap` returned `Bootstrap failed: 5: Input/output error` in this session. Full implementation report: [final-e2.md](../reports/final-e2.md).


## Resolution (2026-09-05)

Witness run 12 on the host (macOS 26, Xcode 26.6, an iPhone 17 simulator) passes all ten steps
at the landed E2 revision; run 9 had passed at `027c04144` before the fix rounds. Runs 1–11
found and fixed, in order: the sandbox cannot reach CoreSimulatorService (the witness runs
outside it); React Native's missing `AbortSignal.throwIfAborted` (`cdd4a3762`); fake-table
markers (schema-valid rows); the offline drain re-marking the persisted watermark
(`e92bfbd2b`, LLP 1012 §6 record); the stale `dist/` project (rebuild first; `shared/` refreshed);
the stopped replay never retried (`027c04144`); the served file URI compared by spelling; AVPlayer
refusing a `data:` video source (v1 refuses view-once video on native — LLP 1013 decision 7,
amended). The six-hour launchd schedule for the witness is installed from the primary checkout
after landing (`node scripts/witness-expo.mjs --print-launchd`).
