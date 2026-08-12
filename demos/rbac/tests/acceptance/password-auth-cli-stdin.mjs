#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import {
  createScratch,
  removeScratch,
  runtimeBinary,
  startRbacServer,
} from './password-auth-kit.mjs';

const scratch = await createScratch('snapback-password-cli-');
let server = null;

function parseCliJson(stdout) {
  const start = stdout.indexOf('{');
  assert(start >= 0, `CLI did not emit JSON: ${stdout}`);
  return JSON.parse(stdout.slice(start));
}

function runPasswordCli(args, password) {
  assert.equal(args.some((argument) => argument.includes(password)), false, 'harness argv contains password');
  assert.equal(Object.values(process.env).some((value) => value === password), false, 'password already exists in inherited environment');
  return new Promise((resolve, reject) => {
    const { SNAPBACK_PASSWORD: _discardedPassword, ...cleanEnvironment } = process.env;
    const child = spawn(runtimeBinary, args, {
      cwd: process.cwd(),
      env: cleanEnvironment,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const observedArgv = [...child.spawnargs];
    assert.equal(
      observedArgv.some((argument) => argument.includes(password)),
      false,
      `spawned process argv contains the password: ${JSON.stringify(observedArgv)}`,
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`password CLI exited ${code ?? signal}: ${stderr}`));
        return;
      }
      assert.equal(stdout.includes(password), false, 'CLI echoed the password to stdout');
      assert.equal(stderr.includes(password), false, 'CLI echoed the password to stderr');
      resolve(Object.freeze({ stdout, stderr, observedArgv }));
    });
    child.stdin.end(`${password}\n`);
  });
}

try {
  server = await startRbacServer({ scratch });
  const email = 'password-cli@example.com';
  const password = 'password-cli-stdin-only-123!';
  const common = ['--url', server.baseUrl, '--email', email, '--password-stdin'];
  const signup = await runPasswordCli(['auth', 'password', 'signup', ...common], password);
  const signupJson = parseCliJson(signup.stdout);
  assert.equal(signupJson.session.provider, 'local-password');
  assert.equal(signupJson.recoveryCodes.length, 8);

  const signin = await runPasswordCli(['auth', 'password', 'signin', ...common], password);
  const signinJson = parseCliJson(signin.stdout);
  assert.equal(signinJson.session.userId, signupJson.session.userId);
  assert.equal(Object.hasOwn(signinJson, 'recoveryCodes'), false);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 7,
    signupSession: signupJson.session.id,
    signinSession: signinJson.session.id,
    passwordCarrier: 'stdin',
    harnessArgvAssertion: true,
    spawnedArgvAssertion: true,
    stdoutSecretScan: true,
    stderrSecretScan: true,
    observedSignupArgv: signup.observedArgv,
    observedSigninArgv: signin.observedArgv,
  })}\n`);
} finally {
  if (server) await server.stop();
  await removeScratch(scratch);
}
