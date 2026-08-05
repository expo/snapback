import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));
const cli = join(packageDir, 'cli.mjs');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-agent-setup-')));

function run(args, cwd = root) {
  return spawnSync(process.execPath, [cli, 'agent', 'setup', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: join(root, 'snapback-native') },
  });
}

function parseTextReceipt(stdout) {
  const lines = stdout.trimEnd().split('\n');
  return JSON.parse(lines.at(-1));
}

try {
  writeFileSync(join(root, 'snapback-native'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(root, 'snapback-native'), 0o755);

  for (const client of ['codex', 'claude', 'cursor', 'generic']) {
    const printed = run(['--print', client]);
    assert.equal(printed.status, 0, `${client}: ${printed.stderr}`);
    assert.match(printed.stdout, /snapback-guide/, `${client} print omitted the read-only server`);
    assert.match(printed.stdout, /snapback-control/, `${client} print omitted the control server`);
    assert.match(printed.stdout, /["']?mcp["']?/, `${client} print omitted the native mcp command`);
    assert.match(printed.stdout, /mcp-control/, `${client} print omitted the packaged control command`);
    if (client === 'codex') {
      assert.match(printed.stdout, /^\[mcp_servers\.snapback-guide\]$/m);
      assert.match(printed.stdout, /^\[mcp_servers\.snapback-control\]$/m);
    } else {
      const config = JSON.parse(printed.stdout);
      assert.deepEqual(Object.keys(config.mcpServers), ['snapback-guide', 'snapback-control']);
    }
  }

  const codexJson = run(['--print', 'codex', '--json']);
  assert.equal(codexJson.status, 0, codexJson.stderr);
  const parsedCodexJson = JSON.parse(codexJson.stdout);
  assert.equal(parsedCodexJson.schemaVersion, 'snapback.agent-setup-print.v1');
  assert.deepEqual(parsedCodexJson.servers, ['mcp', 'mcp-control']);
  assert.equal(parsedCodexJson.targetFile, join(root, '.codex', 'config.toml'));

  const claudeConfig = join(root, '.mcp.json');
  writeFileSync(claudeConfig, `${JSON.stringify({
    unrelated: { keep: true },
    mcpServers: {
      existing: { command: 'existing-server', args: ['--safe'] },
    },
  }, null, 2)}\n`);
  const controlReceiptPath = join(root, 'receipts', 'control.json');
  const installedControl = run([
    '--install', 'claude',
    '--server', 'mcp-control',
    '--receipt', controlReceiptPath,
  ]);
  assert.equal(installedControl.status, 0, installedControl.stderr);
  const controlLines = installedControl.stdout.trimEnd().split('\n');
  assert.equal(controlLines[0], `Target file: ${claudeConfig}`);
  assert.equal(controlLines[1], 'Server: mcp-control');
  assert.equal(
    controlLines[2],
    'Registering mcp-control gives the wired-in MCP client standing admin authority over the local Snapback instance because the server authenticates with the auto-minted local admin token.',
  );
  assert.equal(controlLines[2].match(/[.!?](?:\s|$)/g)?.length, 1, 'authority consequence must be one sentence');
  const controlReceipt = parseTextReceipt(installedControl.stdout);
  assert.equal(controlReceipt.schemaVersion, 'snapback.agent-setup-receipt.v1');
  assert.equal(controlReceipt.operation, 'install');
  assert.equal(controlReceipt.client, 'claude');
  assert.equal(controlReceipt.server, 'mcp-control');
  assert.equal(controlReceipt.serverName, 'snapback-control');
  assert.equal(controlReceipt.targetFile, claudeConfig);
  assert.equal(controlReceipt.changed, true);
  assert.equal(controlReceipt.configFileCreated, false);
  assert.match(controlReceipt.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(controlReceipt.entrySha256, /^sha256:[0-9a-f]{64}$/);
  assert.match(controlReceipt.configurationEntrySha256, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(readFileSync(controlReceiptPath, 'utf8')), controlReceipt);

  const configuredClaude = JSON.parse(readFileSync(claudeConfig, 'utf8'));
  assert.deepEqual(configuredClaude.unrelated, { keep: true });
  assert.deepEqual(configuredClaude.mcpServers.existing, { command: 'existing-server', args: ['--safe'] });
  assert.equal(configuredClaude.mcpServers['snapback-control'].command, cli);
  assert.deepEqual(
    configuredClaude.mcpServers['snapback-control'].args,
    ['mcp-control'],
  );
  assert.doesNotMatch(readFileSync(claudeConfig, 'utf8'), /admin.?token|credential|secret/i);

  const uninstalledControl = run([
    '--uninstall', 'claude',
    '--server', 'mcp-control',
    '--receipt', controlReceiptPath,
  ]);
  assert.equal(uninstalledControl.status, 0, uninstalledControl.stderr);
  const controlUninstallReceipt = JSON.parse(uninstalledControl.stdout);
  assert.equal(controlUninstallReceipt.operation, 'uninstall');
  assert.equal(controlUninstallReceipt.changed, true);
  const restoredClaude = JSON.parse(readFileSync(claudeConfig, 'utf8'));
  assert.deepEqual(restoredClaude, {
    unrelated: { keep: true },
    mcpServers: {
      existing: { command: 'existing-server', args: ['--safe'] },
    },
  });

  const cursorDir = join(root, '.cursor');
  mkdirSync(cursorDir, { recursive: true });
  const cursorConfig = join(cursorDir, 'mcp.json');
  writeFileSync(cursorConfig, `${JSON.stringify({
    mcpServers: { unrelated: { command: 'keep-me' } },
  }, null, 2)}\n`);
  const installedGuide = run(['--install', 'cursor', '--server', 'mcp']);
  assert.equal(installedGuide.status, 0, installedGuide.stderr);
  const guideLines = installedGuide.stdout.trimEnd().split('\n');
  assert.equal(guideLines[0], `Target file: ${cursorConfig}`);
  assert.equal(guideLines[1], 'Server: mcp');
  assert.equal(
    guideLines[2],
    'Registering mcp grants no additional authority because it is a read-only Guide resource server with no mutation or host-operation tools.',
  );
  assert.equal(guideLines[2].match(/[.!?](?:\s|$)/g)?.length, 1, 'read-only consequence must be one sentence');
  const configuredCursor = JSON.parse(readFileSync(cursorConfig, 'utf8'));
  assert.deepEqual(configuredCursor.mcpServers.unrelated, { command: 'keep-me' });
  assert.deepEqual(configuredCursor.mcpServers['snapback-guide'], {
    command: join(root, 'snapback-native'),
    args: ['mcp'],
  });
  const uninstalledGuide = run(['--uninstall', 'cursor', '--server', 'mcp']);
  assert.equal(uninstalledGuide.status, 0, uninstalledGuide.stderr);
  assert.deepEqual(JSON.parse(readFileSync(cursorConfig, 'utf8')), {
    mcpServers: { unrelated: { command: 'keep-me' } },
  });

  const codexRoot = join(root, 'codex-project');
  mkdirSync(join(codexRoot, '.codex'), { recursive: true });
  const codexConfig = join(codexRoot, '.codex', 'config.toml');
  writeFileSync(codexConfig, 'model = "existing-model"\n');
  const installedCodex = run(['--install', 'codex', '--server', 'mcp-control'], codexRoot);
  assert.equal(installedCodex.status, 0, installedCodex.stderr);
  const installedToml = readFileSync(codexConfig, 'utf8');
  assert.match(installedToml, /^model = "existing-model"$/m);
  assert.match(installedToml, /^\[mcp_servers\.snapback-control\]$/m);
  assert.match(installedToml, /^command = /m);
  assert.match(installedToml, /mcp-control/);
  const uninstalledCodex = run(['--uninstall', 'codex', '--server', 'mcp-control'], codexRoot);
  assert.equal(uninstalledCodex.status, 0, uninstalledCodex.stderr);
  assert.equal(readFileSync(codexConfig, 'utf8').trim(), 'model = "existing-model"');

  const createdRoot = join(root, 'created-project');
  mkdirSync(createdRoot);
  const createdReceipt = join(createdRoot, 'install-receipt.json');
  const createdInstall = run([
    '--install', 'claude', '--server', 'mcp-control', '--receipt', createdReceipt,
  ], createdRoot);
  assert.equal(createdInstall.status, 0, createdInstall.stderr);
  assert.equal(existsSync(join(createdRoot, '.mcp.json')), true);
  const createdUninstall = run([
    '--uninstall', 'claude', '--server', 'mcp-control', '--receipt', createdReceipt,
  ], createdRoot);
  assert.equal(createdUninstall.status, 0, createdUninstall.stderr);
  assert.equal(existsSync(join(createdRoot, '.mcp.json')), false, 'receipt-backed uninstall should remove a file created only for this entry');

  console.log('agent-setup.test.mjs: four-client print, authority preview, bounded install, receipts, and exact uninstall pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}
