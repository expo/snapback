// @ref LLP 3000.037.000#8-wave-32-builder-reading-and-waiting-tok1 — signatures come from built declarations, never handwritten API copies.
import ts from 'typescript';
import { getEncoding } from 'js-tiktoken';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url), dist = new URL('dist/', root);
const out = new URL('../../crates/snapback4-lang/src/guide/', root);
const encoding = getEncoding('o200k_base');
// Digests are embedded in the CLI. Do not install duplicate Markdown manuals.
if (!process.argv.includes('--check')) rmSync(new URL('guide-api/', dist), {recursive:true, force:true});
// Names are the wave-34 React/observation/account grep targets. Never silently
// drop a requested declaration to fit: a new surface must earn its reading cost.
const modules = {
  app: ['createApp','AppOptions','AppAuth','AppAuthMethods','AuthSnapshot','AuthState','App','Online'],
  witness: ['registerWebWitness','witnessForm','WitnessReason'],
  react: ['AssetState','AuthSnapshot','AppProvider','useAuth','useAppReady','useSignedInViewer','useOnline','useQueryData','useQueryResult','useNow','useLink','useSaveAsset','useClient','useQuery','usePage','useMutation','useAsset','useUpload','ReadState','ReadHookOptions','PageHook','PagedQuery','WriteHook','MutationHook','UsePage','UseQuery','UseMutation','isFailed','sentResult'],
  proof: ['startDev','startServe','ServeOptions','ProofOptions','ProofHost','DevHost','ServeHost','AdvanceOptions','serveUntilSignal','deploy','cli','CliResult','command','startStatic','withBrowser','signInUI','signOutUI','renderedText','waitForFresh','waitForServer','fillRN','labelledControl','exhaustPages','snapshotAll','cleanup','bounded','serveCheck','ServeCheckOptions','provisionAccounts','ProvisionAccountsOptions','SeedAccountsOptions','StagingAccount','StagingSessions','ProvisionedAccount','probeServeGuard','ProvisionedSessions','uniqueName','freshUser','FreshUserOptions'],
  client: ['createClient','ClientOptions','Client','Observed','ObserveOptions','Read','Ready','Write','refusalOf','Signal','Cursor','AssetRead','Uploaded','UploadOptions','settleMutation','Session','SignIn','MutateOptions','Refusal','Query','Mutation','mintId','idFrom','SettledRead','MutationPromise'],

  auth: ['signup','login','SignIn','Session','SignInOptions','guest','SessionStore','memorySessionStore','restoreSession','keepSession','forgetSession','logout','logoutAll','deleteAccount','refreshSession','narrowSession'],
};
// First line in every shipped declaration. Apply before fingerprinting for stable
// rebuilds and --check; full declarations remain available below the pointer.
for (const name of readdirSync(dist, {recursive:true}).filter(n => n.endsWith('.d.ts'))) {
  const module = name.startsWith('app') ? 'app' : name.startsWith('witness-web') ? 'witness' : name.startsWith('react') ? 'react' : name.startsWith('auth') ? 'auth' : name.startsWith('proof') ? 'proof' : 'client';
  const file = new URL(name, dist), raw = readFileSync(file,'utf8');
  const body = raw.replace(/^\/\/ Day-one API signatures:.*\n/, '');
  const text = `// Day-one API signatures: snapback4 guide api ${module}; full module reference below.\n${body}`;
  if (process.argv.includes('--check')) { if (raw !== text) throw Error(`missing digest pointer: ${name}`); }
  else writeFileSync(file,text);
}
function digest(module, names) {
  const file = fileURLToPath(new URL(`${module === 'witness' ? 'witness-web' : module}.d.ts`, dist));
  const program = ts.createProgram([file], { noResolve: false, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
  const checker = program.getTypeChecker(), source = program.getSourceFile(file);
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
  const hashes = new Map();
  function declarations(name, compact = true) {
    let symbol = exports.find(e => e.name === name);
    if (!symbol) {
      const dependency = ts.createSourceFile('contract.d.ts', readFileSync(new URL('contract.d.ts',dist),'utf8'), ts.ScriptTarget.Latest, true);
      const local = source.statements.find(s => s.name?.text === name);
      if (local) { hashes.set(`${module}.d.ts`, createHash('sha256').update(source.text).digest('hex')); return local.getText(source).replace(/\/\*\*[\s\S]*?\*\//g,'').replace(/\s+/g,' '); }
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
        text = `export interface Client { ${members.map(n => n.getText(source)).join(' ')} /* advanced methods omitted */ }`;
      }
      return text.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/^export declare /, 'export ');
    }).join('\n');
  }
  const pieces = names.map(name => ({ name, text: declarations(name) }));
  let title = `# API ${module}: exact signature digest\n\nImport from "snapback4/${module === 'witness' ? 'witness-web' : module}". Generated from dist declarations; types named below retain their declaration meaning.\n`;
  if (module === 'client') title += 'observe returns getSnapshot/subscribe/close; query returns Read, mutate returns Write (why is undefined unless failed; refusalOf(write) returns Refusal | undefined); asset returns a URL handle or denied. Upload each image column separately. sentResult is from snapback4/react or contract.\n';
  if (module === 'app') title += 'startup?: "progressive" | "awaited". Web devices with a custody probe default to progressive: app.ready means usable client and write custody, not local replica readiness. localStatus(app.client) / useLocalStatus() report engine and acquisition state. "awaited" restores the device-opening barrier; openers without a probe always await. Author ruling 2026-10-30: default now, Lane C qualification follows.\n';
  if (module === 'proof') title += 'Production: startServe(dir,{provisionUsers:{roles:{member:2,admin:2},provision:api.provision}}) returns host.sessions, shaped {member:[account,account],admin:[account,account]}. Account = {kind,role,email,password,principal,token,expiresAt}. Signup grants no role. The private persistent roster is production/proof-accounts/default.json (0600): {version:1,plan,entries:[{role,index,email,password,id,done,principal?,args?}]}; keep it with its store. provisionAccounts reuses this roster; freshUser creates an isolated proof identity instead. Read guide production --section "Serve script and reusable accounts" for partial-setup recovery; never read dist/proof.js.\n';
  if (module === 'witness') title += 'Browser probe after registration: window.__snapback4Witness.beginForm(name, expectedArgumentSubset, button); click that element; await window.__snapback4Witness.formResult(). For awaited uploads, call witnessForm synchronously in the clicked handler, then use its supplied mutate.\n';
  if (module === 'react') title += 'There is no useApp hook: useClient/useAuth/useOnline select its arms. ';
  if (module === 'react') title += 'ReadState uses loading/empty/denied/children. useAuth returns state and signup/login/logout. usePage requires c: cursor ?; run waits for a terminal write. Read/Write/Signal/Session/Cursor: guide api client.\n';

  if (module === 'proof') title += 'Use probe:check for verification; probe:serve stays up until SIGTERM (deliberate harness run: --hold).\n';
  const render = entries => `${title}\n\`\`\`ts\n${entries.map(p => p.text).join('\n')}\n\`\`\`\n`;
  let text = render(pieces);
  // A source digest covers selected and omitted requested declarations, so drift fails.
  text += `\nDeclaration fingerprint: ${createHash('sha256').update(JSON.stringify([...hashes].sort())).digest('hex')}\n`;
  if (encoding.encode(text).length > 2400) throw Error(`guide api ${module} exceeds 2400 tokens`);
  if (module !== 'proof') {
    const complete = `${title}\n\`\`\`ts\n${exports.map(s => declarations(s.name, false)).join('\n')}\n\`\`\`\n`;
    for (const target of [new URL(`api_${module}_full.md`,out)]) {
      if (process.argv.includes('--check')) { if (readFileSync(target,'utf8') !== complete) throw Error(`guide api ${module} --full drift`); }
      else writeFileSync(target, complete);
    }
  }
  return text;
}
// digest() writes full references before returning the compact card. A clean
// client preparation removes dist, so create their common home first.

for (const [module,names] of Object.entries(modules)) {
  const text = digest(module,names), tracked = new URL(`api_${module}.md`,out);
  if (process.argv.includes('--check')) { if (readFileSync(tracked,'utf8') !== text) throw Error(`guide api ${module} drift; rebuild client`); }
  else { writeFileSync(tracked,text); }
  console.log(`guide api ${module}: ${encoding.encode(text).length}/2400 tokens`);
}
