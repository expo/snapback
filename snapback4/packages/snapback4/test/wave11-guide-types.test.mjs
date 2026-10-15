// Published examples typecheck against the real client declarations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { sentResult } from '../dist/contract.js';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const guide = resolve(root, '../../crates/snapback4-lang/src/guide');
const api = `import type { Query, Mutation, Cursor } from './src/contract.ts';
declare const api: {
  inboxCards: Query<{c?:Cursor|null}, {id:string;title:string;memberCount:number}[]>;
  directory: Query<{c?:Cursor|null}, {principal:string;displayName:string}[]>;
  staffNotes: Query<{}, {id:string;title:string}[]>;
  myMembership: Query<{conversationId:string}, {id:string}|null>;
  enroll: Mutation<{team:string;principal:string}, unknown>;
  register: Mutation<{displayName:string}, {principal:string;displayName:string}>;
  send: Mutation<{conversationId:string;body:string}, null>;
};`;
function check(source, index) {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const path = join(root, `__guide_${index}.tsx`);
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
  host.readFile = name => name === path ? source : read(name);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([path], options, host));
  assert.deepEqual(diagnostics.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
}
test('client and production published TSX uses the typed Write union, state gates and both read fallbacks', () => {
  let count = 0;
  for (const file of ['client.md', 'production.md']) {
    const doc = readFileSync(join(guide, file), 'utf8');
    for (const [, block] of doc.matchAll(/```tsx\n([\s\S]*?)\n```/g)) {
      const source = block.replace(/from "snapback4\/(react|auth|app|web)"/g, (_, name) => `from "./src/${name}.${name === 'react' ? 'tsx' : 'ts'}"`)
        .replace(/import \{ api \} from "\.\.\/snapback\/generated\/api";/g, api);
      check(source, count++);
    }
  }
  assert.equal(count, 7, 'Every published TSX block is typechecked');
});

// A form owns its client, save hook and upload error outside this input.
// The input itself is extracted from the packaged guide, so API or snippet
// drift fails against the actual Client/UseMutation declarations.
test('packaged browser image capture narrows upload before placing its asset', () => {
  const binary = process.env.SNAPBACK4_BIN ?? resolve(root, '../../target/debug/snapback4');
  const card = spawnSync(binary, ['guide', 'assets', '--full'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(card.status, 0, card.stdout + card.stderr);
  const block = [...card.stdout.matchAll(/```tsx\n([\s\S]*?)\n```/g)]
    .map(match => match[1]).find(source => source.includes('capture="environment"'));
  assert.ok(block, 'The packaged assets guide includes the image capture example');
  check(`import type { Client, Mutation } from "./src/contract.ts";
import type { UseMutation } from "./src/react.tsx";
declare const client: Client;
declare const save: UseMutation<Mutation<{ photo: { id: string } }, null>>;
declare const setError: (message: string) => void;
export function Capture() { return (${block}); }
`, 'capture');
});


test('the published production composer validates and clears only its fresh receipt draft', async () => {
  const doc = readFileSync(join(guide, 'client.md'), 'utf8');
  const submitSource = doc.match(/async function submit\(\)\{[^\n]+\}/)[0];
  for (const [write, clear] of [
    [{ state:'sent', id:'w', seq:1, result:null }, true],
    [{ state:'sent', id:'w', seq:1, replayed:true }, false],
    [{ state:'pending', id:'w' }, false],
    [{ state:'failed', id:'w', why:{code:'NO'} }, false],
  ]) {
    for (const newerDraft of [false, true]) {
      let settle, calls = 0;
      const context = { draft:'  Hello  ', blocked:false, conversationId:'c', sentResult,
        setSubmitted: () => {}, setDraft: change => {context.draft = change(context.draft);},
        send:{},
      };
      context.send.run = args => {calls++;assert.equal(args.body,'Hello');assert.equal(args.conversationId,'c');return new Promise(resolve=>settle=resolve);};
      const submit = vm.runInNewContext('(' + submitSource + ')', context);
      const pending = submit();
      assert.equal(context.draft,'  Hello  ', 'draft survives while awaiting server receipt');
      if(newerDraft) context.draft='A later edit';
      settle(write);await pending;
      assert.equal(context.draft, newerDraft ? 'A later edit' : clear ? '' : '  Hello  ');
      assert.equal(calls,1);
    }
  }
  for(const [draft,blocked] of [['   ',false],['x'.repeat(2001),false],['Hello',true]]){
    const context={draft,blocked,send:{run:()=>{throw Error('invalid form submitted');}},sentResult};
    await vm.runInNewContext('('+submitSource+')',context)();
  }
});
