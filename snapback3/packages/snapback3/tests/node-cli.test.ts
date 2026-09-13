import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

test("job enqueue CLI distinguishes definite refusal from an unreadable submitted response", async context => {
  const root = await mkdtemp(join(tmpdir(), "snapback3-cli-uncertainty-"));
  await mkdir(join(root, ".snapback3"));
  await writeFile(join(root, ".snapback3/operator.json"), `${JSON.stringify({
    version: 1,
    id: "operator_0123456789abcdef01234567",
    token: `s3op_${"a".repeat(43)}`,
  })}\n`, { mode: 0o600 });
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body);
      if (parsed.op === "definite.refusal") {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: "S3_JOB_INPUT", message: "arguments were refused before enqueue" } }));
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("not-json");
      }
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const cli = resolve("packages/snapback3/dist/cli.mjs");
  context.after(async () => {
    await new Promise<void>(done => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  });

  const run = async (op: string) => {
    try {
      await executeFile(process.execPath, [
        cli, "job", "enqueue", op, "{}", "--as", "system", "--project", root, "--url", url,
      ], { timeout: 5_000, maxBuffer: 1024 * 1024 });
      assert.fail("enqueue unexpectedly succeeded");
    } catch (error) {
      return String((error as { stderr?: string }).stderr ?? "");
    }
  };

  const refused = await run("definite.refusal");
  assert.match(refused, /S3_JOB_INPUT: arguments were refused before enqueue/);
  assert(!refused.includes("may have been enqueued"));
  assert(!refused.includes("job recover"));

  const unreadable = await run("submitted.unreadable");
  assert.match(unreadable, /S3_RESPONSE: The development server returned an unreadable response after submission/);
  assert.match(unreadable, /The job may have been enqueued/);
  assert.match(unreadable, /Do not enqueue it again; run `snapback3 job recover/);
  assert.equal(requests, 2, "the CLI must never replay either POST");
});
