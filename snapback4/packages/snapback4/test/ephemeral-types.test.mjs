import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { ephemeralServer } from './helpers/ephemeral-server.mjs';

test('generated ephemeral API and React preserve disjoint mutation outcomes', async t => {
  const { dir } = await ephemeralServer(t), root = resolve(import.meta.dirname, '..');
  const api = readFileSync(join(dir, 'snapback/generated/api.ts'), 'utf8');
  assert.match(api, /ephemeral: true, renews: true, renewMs: 1000/);
  const fixture = join(root, '__ephemeral_types.tsx');
  const source = api.replace('"snapback4/contract"', '"./src/contract.ts"') + `
import type { Client, Signal, Write, ResultOf, Mutation as Durable, Ephemeral as Eph } from './src/contract.ts';
import { useMutation, usePendingWrite, useQuery } from './src/react.tsx';
declare const client: Client;
type Result = ResultOf<typeof api.setTyping>;
const signal: Promise<Signal<Result>> = client.mutate(api.setTyping, { room: 'r' });
const durable: Promise<Write<unknown>> = client.mutate(api.add, { body: 'hi' });
// @ts-expect-error an ephemeral mutation cannot widen into a durable one
const widened: Durable<{ room: string }, Result> = api.setTyping;
// @ts-expect-error an ephemeral call takes no durable mutation options
client.mutate(api.setTyping, { room: 'r' }, { id: 'id' });
// @ts-expect-error ephemeral mutations do not enter pending-write tracking
usePendingWrite(api.setTyping);
const hook = useMutation(api.setTyping);
const hookResult: Promise<Signal<Result>> = hook.run({ room: 'r' });
const last: Signal<Result> | undefined = hook.last;
// @ts-expect-error signals carry no durable sequence
const wrong: Promise<Write<Result>> = signal;
// @ts-expect-error durable mutations cannot widen into an ephemeral one
const backwards: Eph<{body: string}, unknown> = api.add;
function Typing({room}: {room: string}) {
  const typing = useQuery(api.typingIn, {room});
  const setTyping = useMutation(api.setTyping);
  const stopTyping = useMutation(api.stopTyping);
  return <><input onChange={event => void (event.target.value ? setTyping.run({room}) : stopTyping.run({room}))}/>
    {'data' in typing && typing.data.length > 0 && <span>Someone is typing</span>}</>;
}
`;
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const host = ts.createCompilerHost(parsed.options), read = host.readFile.bind(host);
  host.readFile = path => path === fixture ? source : read(path);
  const program = ts.createProgram([fixture], parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
});
