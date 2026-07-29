#!/usr/bin/env node

// The Todo and Chat confirmations deliberately use byte-identical package-only
// transformation logic. Keeping an arm-local copy prevents either worker from
// editing shared harness or report files.
import '../../../../todo/snapback/final-confirmation-handoff/linux-x64/transform-external.mjs';
