import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const CLIENTS = Object.freeze(['codex', 'claude', 'cursor', 'generic']);
const SERVERS = Object.freeze(['mcp', 'mcp-control']);

const SERVER_DETAILS = Object.freeze({
  mcp: Object.freeze({
    configName: 'snapback-guide',
    authoritySentence: 'Registering mcp grants no additional authority because it is a read-only Guide resource server with no mutation or host-operation tools.',
  }),
  'mcp-control': Object.freeze({
    configName: 'snapback-control',
    authoritySentence: 'Registering mcp-control gives the wired-in MCP client standing admin authority over the local Snapback instance because the server authenticates with the auto-minted local admin token.',
  }),
});

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function targetForClient(client, projectRoot, diagnosticError) {
  if (!CLIENTS.includes(client)) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      `unsupported agent client ${client}; expected one of ${CLIENTS.join(', ')}`,
      { client, supported: CLIENTS },
    );
  }
  switch (client) {
    case 'codex':
      return { format: 'toml', targetFile: join(projectRoot, '.codex', 'config.toml') };
    case 'claude':
      return { format: 'json', targetFile: join(projectRoot, '.mcp.json') };
    case 'cursor':
      return { format: 'json', targetFile: join(projectRoot, '.cursor', 'mcp.json') };
    case 'generic':
      return { format: 'json', targetFile: null };
    default:
      throw new Error(`unreachable agent client ${client}`);
  }
}

function validateServer(server, diagnosticError, { optional = false } = {}) {
  if (optional && server === null) return;
  if (!SERVERS.includes(server)) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      `unsupported MCP server ${server}; expected one of ${SERVERS.join(', ')}`,
      { server, supported: SERVERS },
    );
  }
}

function launchEntry(server, launchers) {
  if (server === 'mcp') {
    return {
      command: launchers.runtimeBinary(),
      args: ['mcp'],
    };
  }
  return {
    command: launchers.packageCli,
    args: ['mcp-control'],
  };
}

function serverEntries(server, launchers) {
  const selected = server === null ? SERVERS : [server];
  return Object.fromEntries(selected.map((serverId) => [
    SERVER_DETAILS[serverId].configName,
    launchEntry(serverId, launchers),
  ]));
}

function tomlEntry(configName, entry) {
  return [
    `[mcp_servers.${configName}]`,
    `command = ${JSON.stringify(entry.command)}`,
    `args = ${JSON.stringify(entry.args)}`,
  ].join('\n');
}

function renderSnippet(client, entries) {
  if (client === 'codex') {
    return Object.entries(entries)
      .map(([configName, entry]) => tomlEntry(configName, entry))
      .join('\n\n') + '\n';
  }
  return `${JSON.stringify({ mcpServers: entries }, null, 2)}\n`;
}

function readJsonConfig(targetFile, diagnosticError) {
  if (!existsSync(targetFile)) return { existed: false, config: {} };
  let config;
  try {
    config = JSON.parse(readFileSync(targetFile, 'utf8'));
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_AGENT_SETUP_CONFIG_INVALID',
      `cannot merge MCP configuration because ${targetFile} is not valid JSON`,
      { targetFile },
    );
    error.cause = cause;
    throw error;
  }
  if (!isPlainObject(config)) {
    throw diagnosticError(
      'SNAPBACK_AGENT_SETUP_CONFIG_INVALID',
      `cannot merge MCP configuration because ${targetFile} is not a JSON object`,
      { targetFile },
    );
  }
  if (config.mcpServers !== undefined && !isPlainObject(config.mcpServers)) {
    throw diagnosticError(
      'SNAPBACK_AGENT_SETUP_CONFIG_INVALID',
      `cannot merge MCP configuration because mcpServers in ${targetFile} is not an object`,
      { targetFile },
    );
  }
  return { existed: true, config };
}

function tomlTableRange(source, configName) {
  const lines = source.match(/.*(?:\n|$)/g)?.filter((line) => line.length > 0) ?? [];
  const table = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegex(configName)}\\]\\s*(?:#.*)?(?:\\r?\\n)?$`);
  const childTable = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegex(configName)}\\.`);
  let startLine = -1;
  let endLine = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    if (startLine === -1) {
      if (table.test(lines[index])) startLine = index;
      continue;
    }
    if (/^\s*\[/.test(lines[index]) && !childTable.test(lines[index])) {
      endLine = index;
      break;
    }
  }
  if (startLine === -1) return null;
  if (startLine > 0
    && lines[startLine - 1].trim() === `# snapback agent setup: ${configName}`) {
    startLine -= 1;
  }
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length);
  return {
    start: offsets[startLine],
    end: offsets[endLine],
    text: source.slice(offsets[startLine], offsets[endLine]),
  };
}

function parseTomlEntry(source) {
  const commandMatch = source.match(/^\s*command\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/m);
  const argsMatch = source.match(/^\s*args\s*=\s*(\[[^\n]*\])\s*(?:#.*)?$/m);
  if (commandMatch === null || argsMatch === null) return null;
  try {
    const command = JSON.parse(commandMatch[1]);
    const args = JSON.parse(argsMatch[1]);
    if (typeof command !== 'string' || !Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
      return null;
    }
    return { command, args };
  } catch {
    return null;
  }
}

function managedTomlBlock(configName, entry) {
  return [
    `# snapback agent setup: ${configName}`,
    tomlEntry(configName, entry),
    `# snapback agent setup end: ${configName}`,
    '',
  ].join('\n');
}

function appendTomlEntry(source, configName, entry, targetFile, diagnosticError) {
  const existing = tomlTableRange(source, configName);
  const block = managedTomlBlock(configName, entry);
  if (existing !== null) {
    if (existing.text.includes(`# snapback agent setup end: ${configName}`)
      && sameJson(parseTomlEntry(existing.text), entry)) {
      return { changed: false, source, representation: JSON.stringify(entry) };
    }
    throw diagnosticError(
      'SNAPBACK_AGENT_SETUP_SERVER_CONFLICT',
      `${targetFile} already defines mcp_servers.${configName}; refusing to replace it`,
      { targetFile, configName },
    );
  }
  const prefix = source.length === 0 ? '' : source.endsWith('\n\n') ? source : source.endsWith('\n') ? `${source}\n` : `${source}\n\n`;
  return { changed: true, source: `${prefix}${block}`, representation: JSON.stringify(entry) };
}

function writeJsonReceipt(path, receipt) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

function loadReceipt(path, diagnosticError) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_AGENT_SETUP_RECEIPT_INVALID',
      `cannot read an agent setup receipt from ${path}`,
      { receiptPath: path },
    );
    error.cause = cause;
    throw error;
  }
  if (receipt?.schemaVersion !== 'snapback.agent-setup-receipt.v1'
    || receipt?.operation !== 'install'
    || typeof receipt?.configurationEntrySha256 !== 'string') {
    throw diagnosticError(
      'SNAPBACK_AGENT_SETUP_RECEIPT_INVALID',
      `${path} is not an install receipt produced by snapback agent setup`,
      { receiptPath: path },
    );
  }
  return receipt;
}

function assertReceiptMatches(receipt, { client, server, targetFile }, diagnosticError) {
  if (receipt.client !== client || receipt.server !== server || resolve(receipt.targetFile) !== targetFile) {
    throw diagnosticError(
      'SNAPBACK_AGENT_SETUP_RECEIPT_MISMATCH',
      'the supplied receipt does not identify this client, server, and target file',
      {
        requested: { client, server, targetFile },
        receipt: { client: receipt.client, server: receipt.server, targetFile: receipt.targetFile },
      },
    );
  }
}

function receiptBase({ operation, client, server, targetFile, entry, representation, changed, configFileCreated, now }) {
  return {
    schemaVersion: 'snapback.agent-setup-receipt.v1',
    ok: true,
    operation,
    client,
    targetFile,
    server,
    serverName: SERVER_DETAILS[server].configName,
    timestamp: now().toISOString(),
    changed,
    configFileCreated,
    entry,
    entrySha256: sha256(JSON.stringify(entry)),
    configurationEntrySha256: sha256(representation),
  };
}

// @ref LLP 0184#4-agent-discovery-and-setup — the read-only and control
// registrations remain separate, and every bounded control-server install
// must disclose its standing local-admin consequence before any config write.
export function printAgentSetup({ client, server = null, projectRoot, launchers, diagnosticError }) {
  validateServer(server, diagnosticError, { optional: true });
  const target = targetForClient(client, resolve(projectRoot), diagnosticError);
  const entries = serverEntries(server, launchers);
  return {
    schemaVersion: 'snapback.agent-setup-print.v1',
    ok: true,
    client,
    targetFile: target.targetFile,
    servers: server === null ? [...SERVERS] : [server],
    snippet: renderSnippet(client, entries),
  };
}

export function installAgentSetup({
  client,
  server,
  projectRoot,
  receiptPath = null,
  launchers,
  diagnosticError,
  beforeWrite,
  now = () => new Date(),
}) {
  validateServer(server, diagnosticError);
  const target = targetForClient(client, resolve(projectRoot), diagnosticError);
  if (target.targetFile === null) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      'generic MCP configuration is print-only because it has no standard project config file',
      { client },
    );
  }
  const targetFile = resolve(target.targetFile);
  const configName = SERVER_DETAILS[server].configName;
  const entry = launchEntry(server, launchers);
  const existed = existsSync(targetFile);

  beforeWrite({
    targetFile,
    server,
    authoritySentence: SERVER_DETAILS[server].authoritySentence,
  });

  let changed;
  let representation;
  if (target.format === 'json') {
    const current = readJsonConfig(targetFile, diagnosticError);
    const mcpServers = { ...(current.config.mcpServers ?? {}) };
    if (Object.hasOwn(mcpServers, configName)) {
      if (!sameJson(mcpServers[configName], entry)) {
        throw diagnosticError(
          'SNAPBACK_AGENT_SETUP_SERVER_CONFLICT',
          `${targetFile} already defines mcpServers.${configName}; refusing to replace it`,
          { targetFile, configName },
        );
      }
      changed = false;
    } else {
      mcpServers[configName] = entry;
      changed = true;
      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, `${JSON.stringify({ ...current.config, mcpServers }, null, 2)}\n`, 'utf8');
    }
    representation = JSON.stringify(entry);
  } else {
    const current = existed ? readFileSync(targetFile, 'utf8') : '';
    const merged = appendTomlEntry(current, configName, entry, targetFile, diagnosticError);
    changed = merged.changed;
    representation = merged.representation;
    if (changed) {
      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, merged.source, 'utf8');
    }
  }

  const receipt = receiptBase({
    operation: 'install',
    client,
    server,
    targetFile,
    entry,
    representation,
    changed,
    configFileCreated: !existed && changed,
    now,
  });
  if (receiptPath !== null) writeJsonReceipt(resolve(receiptPath), receipt);
  return receipt;
}

export function uninstallAgentSetup({
  client,
  server,
  projectRoot,
  receiptPath = null,
  diagnosticError,
  now = () => new Date(),
}) {
  validateServer(server, diagnosticError);
  const target = targetForClient(client, resolve(projectRoot), diagnosticError);
  if (target.targetFile === null) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      'generic MCP configuration is print-only because it has no standard project config file',
      { client },
    );
  }
  const targetFile = resolve(target.targetFile);
  const configName = SERVER_DETAILS[server].configName;
  const retainedReceipt = receiptPath === null ? null : loadReceipt(resolve(receiptPath), diagnosticError);
  if (retainedReceipt !== null) {
    assertReceiptMatches(retainedReceipt, { client, server, targetFile }, diagnosticError);
    if (retainedReceipt.changed === false) {
      return receiptBase({
        operation: 'uninstall', client, server, targetFile,
        entry: retainedReceipt.entry,
        representation: JSON.stringify(retainedReceipt.entry),
        changed: false, configFileCreated: false, now,
      });
    }
  }
  if (!existsSync(targetFile)) {
    return receiptBase({
      operation: 'uninstall', client, server, targetFile,
      entry: retainedReceipt?.entry ?? null,
      representation: '', changed: false, configFileCreated: false, now,
    });
  }

  let changed = false;
  let representation = '';
  let removeFile = false;
  let entry = retainedReceipt?.entry ?? null;
  if (target.format === 'json') {
    const current = readJsonConfig(targetFile, diagnosticError);
    const mcpServers = { ...(current.config.mcpServers ?? {}) };
    if (Object.hasOwn(mcpServers, configName)) {
      entry = mcpServers[configName];
      representation = JSON.stringify(entry);
      if (retainedReceipt !== null
        && sha256(representation) !== retainedReceipt.configurationEntrySha256) {
        throw diagnosticError(
          'SNAPBACK_AGENT_SETUP_RECEIPT_MISMATCH',
          `mcpServers.${configName} has changed since the supplied receipt was issued`,
          { targetFile, configName },
        );
      }
      delete mcpServers[configName];
      const next = { ...current.config, mcpServers };
      changed = true;
      removeFile = retainedReceipt?.configFileCreated === true
        && Object.keys(next).length === 1
        && Object.keys(mcpServers).length === 0;
      if (removeFile) rmSync(targetFile);
      else writeFileSync(targetFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    }
  } else {
    const current = readFileSync(targetFile, 'utf8');
    const range = tomlTableRange(current, configName);
    if (range !== null) {
      entry = parseTomlEntry(range.text);
      representation = JSON.stringify(entry);
      if (retainedReceipt !== null
        && sha256(representation) !== retainedReceipt.configurationEntrySha256) {
        throw diagnosticError(
          'SNAPBACK_AGENT_SETUP_RECEIPT_MISMATCH',
          `mcp_servers.${configName} has changed since the supplied receipt was issued`,
          { targetFile, configName },
        );
      }
      const next = `${current.slice(0, range.start)}${current.slice(range.end)}`
        .replace(/\n{3,}/g, '\n\n');
      changed = true;
      removeFile = retainedReceipt?.configFileCreated === true && next.trim().length === 0;
      if (removeFile) rmSync(targetFile);
      else writeFileSync(targetFile, next, 'utf8');
    }
  }

  return receiptBase({
    operation: 'uninstall',
    client,
    server,
    targetFile,
    entry,
    representation,
    changed,
    configFileCreated: false,
    now,
  });
}

export const __test = {
  CLIENTS,
  SERVERS,
  SERVER_DETAILS,
  targetForClient,
  tomlTableRange,
};
