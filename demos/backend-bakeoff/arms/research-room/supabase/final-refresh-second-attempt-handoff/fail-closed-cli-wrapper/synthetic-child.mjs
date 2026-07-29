#!/usr/bin/env node

const scenario = process.argv[2];

if (scenario === "success") {
  process.stdout.write("\u001b[32m│ API URL │ http://127.0.0.1:58105 │\u001b[0m\n");
  process.stdout.write("\u001b[35m│ Publishable │ sb_publishable_CANARY_ALPHA │\u001b[0m\n");
  process.stdout.write("│ Secret │ sb_secret_CANARY_BRAVO │\n");
  process.stdout.write("API_URL=http://127.0.0.1:58105\n");
  process.stdout.write("REST_URL=http://127.0.0.1:58105/rest/v1\n");
  process.stdout.write("GRAPHQL_URL=http://127.0.0.1:58105/graphql/v1\n");
  process.stdout.write("STORAGE_S3_URL=http://127.0.0.1:58105/storage/v1/s3\n");
  process.stdout.write("MCP_URL=http://127.0.0.1:58105/mcp\n");
  process.stdout.write("FUNCTIONS_URL=http://127.0.0.1:58105/functions/v1\n");
  process.stdout.write("DB_URL=postgresql://CANARY_DB\n");
  process.stdout.write("STUDIO_URL=http://127.0.0.1:58107\n");
  process.stdout.write("INBUCKET_URL=http://127.0.0.1:58108\n");
  process.stdout.write("MAILPIT_URL=http://127.0.0.1:58108\n");
  process.stdout.write("JWT_SECRET=eyJhbGciOiJIUzI1NiJ9.CANARY_JWT.SIGNATURE\n");
  process.stdout.write("ANON_KEY=eyJhbGciOiJIUzI1NiJ9.CANARY_ANON.SIGNATURE\n");
  process.stdout.write("PUBLISHABLE_KEY=sb_publishable_CANARY_ALPHA\n");
  process.stdout.write("SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiJ9.CANARY_ROLE.SIGNATURE\n");
  process.stdout.write("SECRET_KEY=sb_secret_CANARY_BRAVO\n");
  process.stdout.write("S3_PROTOCOL_ACCESS_KEY_ID=CANARY_S3_ACCESS\n");
  process.stdout.write("S3_PROTOCOL_ACCESS_KEY_SECRET=CANARY_S3_SECRET\n");
  process.stdout.write("S3_PROTOCOL_REGION=local\n");
  process.stderr.write("diagnostic failure output remains private\n");
} else if (scenario === "current-start-pretty") {
  process.stdout.write("╭──────────────────────────────────────────╮\n");
  process.stdout.write("│ 🌐 APIs                                  │\n");
  process.stdout.write("├────────────────┬─────────────────────────┤\n");
  process.stdout.write("│ Project URL    │ http://127.0.0.1:58105 │\n");
  process.stdout.write("│ REST           │ http://127.0.0.1:58105/rest/v1 │\n");
  process.stdout.write("│ GraphQL        │ http://127.0.0.1:58105/graphql/v1 │\n");
  process.stdout.write("│ Edge Functions │ http://127.0.0.1:58105/functions/v1 │\n");
  process.stdout.write("╰────────────────┴─────────────────────────╯\n");
  process.stdout.write("│ 🔑 Authentication Keys │\n");
  process.stdout.write("│ Publishable │ sb_publishable_CANARY_PRETTY │\n");
  process.stdout.write("│ Secret │ sb_secret_CANARY_PRETTY │\n");
  process.stdout.write("│ 📦 Storage (S3) │\n");
  process.stdout.write("│ URL │ http://127.0.0.1:58105/storage/v1/s3 │\n");
  process.stdout.write("│ Access Key │ CANARY_PRETTY_S3_ACCESS │\n");
  process.stdout.write("│ Secret Key │ CANARY_PRETTY_S3_SECRET │\n");
  process.stdout.write("│ Region │ local │\n");
  process.stderr.write("startup diagnostics remain private\n");
} else if (scenario === "unexpected") {
  process.stdout.write("│ API URL │ http://127.0.0.1:58105 │\n");
  process.stdout.write("│ Publishable key │ sb_publishable_CANARY_CHARLIE │\n");
  process.stdout.write("│ Secret key │ sb_secret_CANARY_DELTA │\n");
  process.stdout.write("SUPABASE_UNEXPECTED_TOKEN=CANARY_UNEXPECTED\n");
} else if (scenario === "failure") {
  process.stdout.write("SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.CANARY_FAILURE.JWT\n");
  process.stderr.write("failed with sb_secret_CANARY_ECHO and sb_publishable_CANARY_FOXTROT\n");
  process.exitCode = 42;
} else {
  process.stderr.write("unknown synthetic scenario\n");
  process.exitCode = 64;
}
