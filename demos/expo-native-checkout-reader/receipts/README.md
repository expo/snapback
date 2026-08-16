# Live witness receipts

`run-witness.mjs` creates one `0600` JSON file per witness row in a dated
subdirectory. No checked-in receipt exists yet: simulator, emulator, and USB
device runs are intentionally delegated to an orchestrator outside the agent
sandbox. Successful live receipts should be reviewed for secret absence and
landed here to close `issues/20260816-0262-expo-native-checkout-reader.md`.
