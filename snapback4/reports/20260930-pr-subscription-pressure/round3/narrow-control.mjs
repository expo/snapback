// Evaluate the resumed-owner-only watermark check without touching full-suite inputs.
import {readFileSync,writeFileSync,cpSync} from 'node:fs';
import ts from 'typescript';
const base='target/pr-r3-ll-control/packages/snapback4';
cpSync('packages/snapback4/dist',base+'/dist',{recursive:true});
const source=readFileSync('packages/snapback4/src/local.ts','utf8')
 .replace('if (watch.changeCut !== undefined) {','if (watch.detachedEpoch !== undefined && watch.changeCut !== undefined) {')
 .replace('if (state) answers.reconcile(watch, state.watermark);','checkRead(signal); if (state) { answers.reconcile(watch, state.watermark); delete watch.detachedEpoch; }');
writeFileSync('reports/20260930-pr-subscription-pressure/round3/local-narrow-candidate.txt',source);
writeFileSync(base+'/dist/local.js',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,rewriteRelativeImportExtensions:true}}).outputText);
