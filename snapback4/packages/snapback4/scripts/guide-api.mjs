// @ref LLP 3000.037.000#8-wave-32-builder-reading-and-waiting-tok1 — signatures come from built declarations, never handwritten API copies.
import ts from 'typescript';
import { getEncoding } from 'js-tiktoken';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url), dist = new URL('dist/', root);
const out = new URL('../../crates/snapback4-lang/src/guide/', root);
const encoding = getEncoding('o200k_base');
const modules = {
  proof: ['startDev','startServe','ServeOptions','ProofOptions','ProofHost','serveUntilSignal','probeServeGuard','deploy','cli','command','startStatic','withBrowser','renderedText','labelledControl','waitForFresh','exhaustPages','snapshotAll','serveCheck','ServeCheckOptions','provisionAccounts','ProvisionAccountsOptions','SeedAccountsOptions','StagingSessions','DevHost','ServeHost','CliResult','ProvisionedSessions','StagingAccount','uniqueName','freshUser','FreshUserOptions'],
  client: ['createClient','ClientOptions','Client','Observed','ObserveOptions','Read','Write','Signal','Cursor','AssetRead','Uploaded','settleMutation','Session','SignIn','Query','Mutation','MutateOptions','mintId','idFrom','Ready','SettledRead','Refusal','MutationPromise','UploadOptions'],
  auth: ['signup','login','SignIn','Session','SignInOptions','guest','SessionStore','memorySessionStore','restoreSession','keepSession','forgetSession','logout','logoutAll','refreshSession','narrowSession'],
};
function digest(module, names) {
  const file = fileURLToPath(new URL(`${module}.d.ts`, dist));
  const program = ts.createProgram([file], { noResolve: false, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  const checker = program.getTypeChecker(), source = program.getSourceFile(file);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
  const hashes = new Map();
  function declarations(name, compact = true) {
    let symbol = exports.find(e => e.name === name);
    if (!symbol) {
      const dependency = ts.createSourceFile('contract.d.ts', readFileSync(new URL('contract.d.ts',dist),'utf8'), ts.ScriptTarget.Latest, true);
      const node = dependency.statements.find(s => s.name?.text === name);
      if (!node) throw Error(`guide api ${module}: type ${name} missing`);
      hashes.set('contract.d.ts', createHash('sha256').update(dependency.text).digest('hex'));
      return `// ${name}: import type from snapback4/contract\n` + node.getText(dependency).replace(/\/\*\*[\s\S]*?\*\//g,'').replace(/\s+/g,' ');
    }
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return (symbol.declarations ?? []).map(node => {
      const source = node.getSourceFile();
      hashes.set(source.fileName.split('/').at(-1), createHash('sha256').update(source.text).digest('hex'));
      let text = (ts.isVariableDeclaration(node) ? 'export const ' : '') + node.getText(source);
      // Client's core methods replace the much larger advanced-lifecycle surface.
      if (compact && name === 'Client' && ts.isInterfaceDeclaration(node)) {
        const wanted = ['query','mutate','observe','upload','asset','close','watch'];
        const members = node.members.filter(n => wanted.includes(n.name?.getText(source)));
        text = `export interface Client { ${members.map(n => n.getText(source)).join(' ')} /* other methods: dist/contract.d.ts */ }`;
      }
      return text.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/^export declare /, 'export ');
    }).join('\n');
  }
  const pieces = names.map(name => ({ name, text: declarations(name) }));
  let title = `# API ${module}: exact signature digest\n\nImport from "snapback4/${module}". Generated from dist declarations; types named below retain their declaration meaning.\n`;
  if (module === 'client') title += 'observe returns getSnapshot/subscribe/close; query returns Read, mutate returns Write; asset returns a URL handle or denied. Upload each image column separately. sentResult is from snapback4/react or contract.\n';
  if (module === 'proof') title += 'Production: startServe(dir,{provisionUsers:{roles:{member:2,admin:2},provision:api.provision}}) returns host.sessions, shaped {member:[account,account],admin:[account,account]}. Account = {kind,role,email,password,principal,token,expiresAt}. Signup grants no role. The private persistent roster is production/proof-accounts/default.json (0600): {version:1,plan,entries:[{role,index,email,password,id,done,principal?,args?}]}; keep it with its store. provisionAccounts reuses this roster; freshUser creates an isolated proof identity instead. Read guide production --section "Serve script and reusable accounts" for partial-setup recovery; never read dist/proof.js.\n';
  if (module === 'proof') title += 'Use probe:check for verification; probe:serve stays up until SIGTERM (deliberate harness run: --hold).\n';
  const render = entries => `${title}\n\`\`\`ts\n${entries.map(p => p.text).join('\n')}\n\`\`\`\n\nOther exports/options: dist/${module}.d.ts; follow its named imports only on demand.\n`;
  const selected = [];
  for (const piece of pieces) { if (encoding.encode(render([...selected,piece])).length <= 2800) selected.push(piece); }
  const omitted = pieces.filter(p => !selected.includes(p)).map(p => p.name);
  let text = render(selected);
  if (omitted.length) text += `Additional requested declarations in dist/${module}.d.ts: ${omitted.join(', ')}.\n`;
  // A source digest covers selected and omitted requested declarations, so drift fails.
  text += `\nDeclaration fingerprint: ${createHash('sha256').update(JSON.stringify([...hashes].sort())).digest('hex')}\n`;
  if (encoding.encode(text).length > 3000) throw Error(`guide api ${module} exceeds 3000 tokens`);
  if (module !== 'proof') {
    const complete = `${title}\n\`\`\`ts\n${exports.map(s => declarations(s.name, false)).join('\n')}\n\`\`\`\n`;
    for (const target of [new URL(`api_${module}_full.md`,out), new URL(`guide-api/${module}-full.md`,dist)]) {
      if (process.argv.includes('--check')) { if (readFileSync(target,'utf8') !== complete) throw Error(`guide api ${module} --full drift`); }
      else writeFileSync(target, complete);
    }
  }
  return text;
}
for (const [module,names] of Object.entries(modules)) {
  const text = digest(module,names), tracked = new URL(`api_${module}.md`,out), packed = new URL(`guide-api/${module}.md`,dist);
  mkdirSync(new URL('guide-api/',dist), { recursive:true });
  if (process.argv.includes('--check')) { if (readFileSync(tracked,'utf8') !== text || readFileSync(packed,'utf8') !== text) throw Error(`guide api ${module} drift; rebuild client`); }
  else { writeFileSync(tracked,text); writeFileSync(packed,text); }
  console.log(`guide api ${module}: ${encoding.encode(text).length}/3000 tokens`);
}
