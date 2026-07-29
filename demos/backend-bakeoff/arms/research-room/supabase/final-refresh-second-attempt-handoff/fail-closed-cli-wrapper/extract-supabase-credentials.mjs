#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const KEY_NAMES = [
  "api_url",
  "anon_key",
  "publishable_key",
  "service_role_key",
  "secret_key",
  "s3_access_key_id",
  "s3_access_key_secret",
];
const ENV_LABELS = new Map([
  ["API_URL", "api_url"],
  ["ANON_KEY", "anon_key"],
  ["PUBLISHABLE_KEY", "publishable_key"],
  ["SERVICE_ROLE_KEY", "service_role_key"],
  ["SECRET_KEY", "secret_key"],
  ["S3_PROTOCOL_ACCESS_KEY_ID", "s3_access_key_id"],
  ["S3_PROTOCOL_ACCESS_KEY_SECRET", "s3_access_key_secret"],
  ["SUPABASE_URL", "api_url"],
  ["SUPABASE_ANON_KEY", "anon_key"],
  ["SUPABASE_PUBLISHABLE_KEY", "publishable_key"],
  ["SUPABASE_SERVICE_ROLE_KEY", "service_role_key"],
  ["SUPABASE_SECRET_KEY", "secret_key"],
]);
const IGNORED_ENV_LABELS = new Set([
  "REST_URL",
  "GRAPHQL_URL",
  "STORAGE_S3_URL",
  "MCP_URL",
  "FUNCTIONS_URL",
  "DB_URL",
  "STUDIO_URL",
  "INBUCKET_URL",
  "MAILPIT_URL",
  "JWT_SECRET",
  "S3_PROTOCOL_REGION",
]);
const TABLE_LABELS = new Map([
  ["api url", "api_url"],
  ["project url", "api_url"],
  ["anon key", "anon_key"],
  ["publishable", "publishable_key"],
  ["publishable key", "publishable_key"],
  ["service_role key", "service_role_key"],
  ["service role key", "service_role_key"],
  ["secret", "secret_key"],
  ["access key", "s3_access_key_id"],
  ["s3 access key", "s3_access_key_id"],
  ["s3 access key id", "s3_access_key_id"],
  ["secret key", "s3_access_key_secret"],
  ["s3 secret key", "s3_access_key_secret"],
  ["s3 access key secret", "s3_access_key_secret"],
]);
const IGNORED_TABLE_LABELS = new Set([
  "graphql url",
  "s3 storage url",
  "db url",
  "studio url",
  "inbucket url",
  "mail url",
  "mailpit url",
  "jwt secret",
  "s3 region",
  "s3 access key region",
]);

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("invalid arguments");
    values.set(flag, value);
  }
  const required = [
    "--raw-stdout",
    "--raw-stderr",
    "--carrier-root",
    "--manifest",
    "--synthetic-mode",
  ];
  if (!required.every((flag) => values.has(flag))) throw new Error("missing arguments");
  return Object.fromEntries(required.map((flag) => [flag.slice(2), values.get(flag)]));
}

function stripAnsi(value) {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

function put(values, key, value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "");
  if (!normalized || normalized.includes("\n") || normalized.length > 16384) {
    throw new Error("invalid value");
  }
  if (key === "api_url" && !/^https?:\/\//.test(normalized)) {
    throw new Error("invalid URL");
  }
  if (values.has(key) && values.get(key) !== normalized) {
    throw new Error("conflicting aliases");
  }
  values.set(key, normalized);
}

function discover(raw) {
  const values = new Map();
  let unexpectedParserKey = false;
  for (const sourceLine of stripAnsi(raw).split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) continue;

    const assignment = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (assignment) {
      const label = assignment[1];
      if (ENV_LABELS.has(label)) {
        put(values, ENV_LABELS.get(label), assignment[2]);
      } else if (!IGNORED_ENV_LABELS.has(label)) {
        unexpectedParserKey = true;
      }
      continue;
    }

    const cells = line
      .split(/[│|]/)
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    const label = cells[0].toLowerCase().replace(/\s+/g, " ");
    if (TABLE_LABELS.has(label)) {
      put(values, TABLE_LABELS.get(label), cells[1]);
    } else if (IGNORED_TABLE_LABELS.has(label)) {
      continue;
    } else if (/(?:key|secret|token|password|credential)/i.test(label)) {
      unexpectedParserKey = true;
    }
  }
  return { values, unexpectedParserKey };
}

function privateWrite(path, body) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(fd, body, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!["none", "crash", "malformed"].includes(args["synthetic-mode"])) {
    throw new Error("invalid synthetic mode");
  }
  if (
    !existsSync(args["carrier-root"]) ||
    (lstatSync(args["carrier-root"]).mode & 0o777) !== 0o700 ||
    lstatSync(args["carrier-root"]).isSymbolicLink()
  ) {
    throw new Error("unsafe carrier root");
  }
  const raw =
    readFileSync(args["raw-stdout"], "utf8") +
    "\n" +
    readFileSync(args["raw-stderr"], "utf8");
  const { values, unexpectedParserKey } = discover(raw);
  if (args["synthetic-mode"] === "crash") {
    throw new Error("synthetic parser failure");
  }
  const requiredKeysPresent =
    values.has("api_url") &&
    (values.has("anon_key") || values.has("publishable_key")) &&
    (values.has("service_role_key") || values.has("secret_key"));
  const ok = requiredKeysPresent && !unexpectedParserKey;
  const keyPresence = Object.fromEntries(
    KEY_NAMES.map((key) => [key, ok && values.has(key)]),
  );

  if (ok) {
    for (const key of KEY_NAMES) {
      if (values.has(key)) {
        privateWrite(join(args["carrier-root"], key), values.get(key));
      }
    }
  }

  const result = {
    ok,
    unexpected_parser_key: unexpectedParserKey,
    required_keys_present: requiredKeysPresent,
    key_presence: keyPresence,
  };
  if (args["synthetic-mode"] === "malformed") {
    privateWrite(args.manifest, "{");
    process.stdout.write(
      `${JSON.stringify({
        key_presence: keyPresence,
        unexpected_parser_key: false,
        required_keys_present: true,
      })}\n`,
    );
    return;
  }
  privateWrite(args.manifest, `${JSON.stringify(result)}\n`);
  process.stdout.write(
    `${JSON.stringify({
      key_presence: keyPresence,
      unexpected_parser_key: unexpectedParserKey,
      required_keys_present: requiredKeysPresent,
    })}\n`,
  );
  process.exitCode = ok ? 0 : 65;
}

main().catch(() => {
  process.stdout.write(
    `${JSON.stringify({
      key_presence: Object.fromEntries(KEY_NAMES.map((key) => [key, false])),
      unexpected_parser_key: true,
      required_keys_present: false,
    })}\n`,
  );
  process.exitCode = 65;
});
