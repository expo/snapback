// The proof export census, signatures, result fields and failures come from TypeScript.
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function proofApi() {
  const config=ts.readConfigFile(resolve(root,'packages/snapback4/tsconfig.build.json'),ts.sys.readFile);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve(root,'packages/snapback4'));
  const program=ts.createProgram(parsed.fileNames,parsed.options), checker=program.getTypeChecker();
  const source=program.getSourceFile(resolve(root,'packages/snapback4/src/proof.ts'));
  const module=checker.getSymbolAtLocation(source);
  const fmt=ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
  const show=type=>checker.typeToString(type,source,fmt).replace(/import\("[^"]+"\)\./g,'');
  const cell=text=>text.replace(/\|/g,'\\|').replace(/\s+/g,' ').trim();
  const fields=type=>{
    type=checker.getAwaitedType(type)??type;
    if(checker.isArrayType(type)) return `Array of ${fields(checker.getTypeArguments(type)[0])}`;
    if(type.isUnion()) return type.types.map(fields).join(' or ');
    const name=show(type);
    if(!['ProofHost','DevHost','CliResult','TestSourceResult','FixtureRow'].includes(name)) return name;
    return `{ ${checker.getPropertiesOfType(type).map(p=>`${p.name}${p.flags&ts.SymbolFlags.Optional?'?':''}: ${show(checker.getTypeOfSymbolAtLocation(p,source))}`).join('; ')} }`;
  };
  const functions=[],types=[];
  for(let symbol of checker.getExportsOfModule(module).sort((a,b)=>a.name.localeCompare(b.name))) {
    const name=symbol.name;
    if(symbol.flags&ts.SymbolFlags.Alias) symbol=checker.getAliasedSymbol(symbol);
    const type=checker.getTypeOfSymbolAtLocation(symbol,source), signatures=type.getCallSignatures();
    if(signatures.length){
      const failures=symbol.getJsDocTags(checker).filter(tag=>tag.name==='throws').map(tag=>tag.text?.map(part=>part.text).join('')??'').join('; ');
      if(!failures) throw Error(`proof export ${name} needs source @throws documentation`);
      functions.push(`| ${signatures.map(sig=>'`'+cell(name+checker.signatureToString(sig,source,fmt))+'`').join('<br>')} | \`${cell(fields(checker.getReturnTypeOfSignature(signatures[0])))}\` | ${cell(failures)} |`);
    } else {
      const declared=checker.getDeclaredTypeOfSymbol(symbol);
      types.push(`| \`${name}\` | \`${cell(fields(declared)===''+name ? checker.getPropertiesOfType(declared).map(p=>`${p.name}${p.flags&ts.SymbolFlags.Optional?'?':''}: ${show(checker.getTypeOfSymbolAtLocation(p,source))}`).join('; ') : fields(declared))}\` |`);
    }
  }
  return '## Proof API (generated from source)\n\nEvery runtime and type export of `snapback4/proof` is listed below. Signatures, result fields and failure reasons are generated from TypeScript declarations and their @throws comments; qualification checks this table against the source. Playwright types such as Page and Locator come from playwright-core.\n\n| Signature | Result / fields | Failure reasons |\n|---|---|---|\n'+functions.join('\n')+'\n\n| Exported type | Fields |\n|---|---|\n'+types.join('\n')+'\n';
}
const path=resolve(root,'crates/snapback4-lang/src/guide/proof_api.md');
const output=proofApi();
if(process.argv.includes('--check')) {if(readFileSync(path,'utf8')!==output) throw Error('proof API table is stale; run node scripts/generate-proof-api.mjs');}
else writeFileSync(path,output);
