#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 15_000,
    env: options.env ?? process.env,
  });
  return {
    command: [command, ...args],
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function platformName(identifier) {
  return typeof identifier === "string"
    ? identifier.replace("com.apple.platform.", "")
    : null;
}

const hostname = run("/bin/hostname", [], { timeout: 2_000 });
const uname = run("/usr/bin/uname", ["-srm"], { timeout: 2_000 });
const receipt = {
  schemaVersion: "snapback2.physical-device-availability.v1",
  observedAt: new Date().toISOString(),
  host: hostname.stdout.trim() || null,
  platform: uname.stdout.trim() || process.platform,
  apple: { attempted: false },
  android: { attempted: false },
};

if (process.platform === "darwin") {
  const developerDir = "/Applications/Xcode.app/Contents/Developer";
  const xcdevice = run("/usr/bin/xcrun", ["xcdevice", "list", "--timeout", "5"], {
    timeout: 20_000,
    env: { ...process.env, DEVELOPER_DIR: developerDir },
  });
  const apple = {
    attempted: true,
    command: `DEVELOPER_DIR=${developerDir} xcrun xcdevice list --timeout 5`,
    status: xcdevice.status,
    signal: xcdevice.signal,
    error: xcdevice.error,
    stderr: xcdevice.stderr.trim() || null,
    parseError: null,
    physicalDevices: [],
    onlinePhysicalPhones: [],
  };
  try {
    const rows = JSON.parse(xcdevice.stdout);
    apple.physicalDevices = rows
      .filter((row) => row.simulator === false)
      .map((row) => ({
        name: row.name ?? null,
        identifier: row.identifier ?? null,
        modelName: row.modelName ?? null,
        platform: platformName(row.platform),
        operatingSystemVersion: row.operatingSystemVersion ?? null,
        available: row.available === true,
        ignored: row.ignored === true,
        interface: row.interface ?? null,
        error: row.error
          ? {
              domain: row.error.domain ?? null,
              code: row.error.code ?? null,
              description: row.error.description ?? null,
            }
          : null,
      }));
    apple.onlinePhysicalPhones = apple.physicalDevices.filter(
      (row) => row.platform === "iphoneos"
        && row.available
        && `${row.modelName ?? ""} ${row.name ?? ""}`.toLowerCase().includes("iphone"),
    );
  } catch (error) {
    apple.parseError = error instanceof Error ? error.message : String(error);
  }
  receipt.apple = apple;
}

const adbCandidates = [
  join(homedir(), "Library/Android/sdk/platform-tools/adb"),
  join(homedir(), "Android/Sdk/platform-tools/adb"),
  "/opt/homebrew/bin/adb",
  "/usr/local/bin/adb",
  "/usr/bin/adb",
];
let adbPath = adbCandidates.find((candidate) => existsSync(candidate));
if (!adbPath) {
  const which = run("/usr/bin/which", ["adb"], { timeout: 2_000 });
  if (which.status === 0 && which.stdout.trim()) adbPath = which.stdout.trim();
}

if (adbPath) {
  const adb = run(adbPath, ["devices", "-l"], { timeout: 10_000 });
  const devices = adb.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "List of devices attached")
    .map((line) => {
      const fields = line.split(/\s+/);
      const serial = fields[0];
      const state = fields[1] ?? null;
      const properties = Object.fromEntries(
        fields.slice(2).filter((field) => field.includes(":"))
          .map((field) => field.split(/:(.*)/s).slice(0, 2)),
      );
      const descriptor = `${serial} ${properties.product ?? ""} ${properties.model ?? ""} ${properties.device ?? ""}`.toLowerCase();
      return {
        serial,
        state,
        product: properties.product ?? null,
        model: properties.model ?? null,
        device: properties.device ?? null,
        transportId: properties.transport_id ?? null,
        emulator: serial.startsWith("emulator-") || descriptor.includes("sdk_gphone") || descriptor.includes("emulator"),
      };
    });
  receipt.android = {
    attempted: true,
    command: `${adbPath} devices -l`,
    status: adb.status,
    signal: adb.signal,
    error: adb.error,
    stderr: adb.stderr.trim() || null,
    devices,
    onlinePhysicalPhones: devices.filter((row) => row.state === "device" && !row.emulator),
  };
} else {
  receipt.android = {
    attempted: false,
    reason: "adb executable not found in the standard SDK, Homebrew, or PATH locations",
  };
}

receipt.eligibleOnlinePhysicalPhone =
  (receipt.apple.onlinePhysicalPhones?.length ?? 0) > 0
  || (receipt.android.onlinePhysicalPhones?.length ?? 0) > 0;

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
