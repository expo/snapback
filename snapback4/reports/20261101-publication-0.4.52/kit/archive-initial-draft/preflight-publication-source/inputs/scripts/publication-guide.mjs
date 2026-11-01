// Corpus extractors deliberately follow every bounded section and packed source pointer.
// Builders read one section at a time; this helper is never a CLI budget bypass.
import { spawnSync } from "node:child_process";
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export function guideReference(cli, card, options = {}) {
  const actual=realpathSync(cli),js=/\.[cm]?js$/.test(actual);
  const {packageRoot:explicitPackage,...spawnOptions}=options;
  const sibling=join(dirname(actual),'..','snapback4');
  const packageRoot=realpathSync(resolve(explicitPackage ?? process.env.SNAPBACK4_PROOF_PACKAGE ?? (js?join(dirname(actual),'..'):existsSync(join(sibling,'package.json'))?sibling:fileURLToPath(new URL('../packages/snapback4',import.meta.url)))));
  const expand=text=>text.replace(/^Complete reference: node_modules\/snapback4\/(dist\/recipes\/[A-Za-z0-9_./-]+)\. Read only this file when adapting that example\.\s*$/gm,(_,relative)=>{
    const path=realpathSync(resolve(packageRoot,relative));
    if(!path.startsWith(packageRoot+sep))throw Error('guide reference escaped the package');
    const source=readFileSync(path,'utf8'),social=relative.includes('/social/');
    const language=path.endsWith('.tsx')?'tsx':path.endsWith('.ts')?'ts':'js';
    return '```'+language+'\n'+(social?'// src/'+path.split(sep).at(-1)+'\n':'')+source.replace(/\n?$/,'\n')+'```\n';
  });
  const env={...(spawnOptions.env??process.env)};
  if(js&&actual.includes(sep+'node_modules'+sep))delete env.SNAPBACK4_BIN;
  const invoke = args => {
    const result = spawnSync(js?process.execPath:actual, [...(js?[actual]:[]),"guide",...card.split(/\s+/),...args], {encoding:"utf8",timeout:30_000,maxBuffer:4*1024*1024,...spawnOptions,env});
    if (result.status !== 0) throw Error(result.stderr + result.stdout);
    return result.stdout;
  };
  const index = invoke(["--sections"]);
  const numbers = [...index.matchAll(/^\s*(\d+)\. /gm)].map(match=>match[1]);
  if (!numbers.length) return expand(invoke(["--full","--repeat"]));
  const pieces = index.includes("1. Opening (") ? [] : [invoke(["--section","opening","--repeat"])];
  for (const number of numbers) {
    const text=invoke(["--section",number,"--repeat"]);
    const body=text.slice(text.indexOf("\n")+1).trim();
    // Small cards retain nested headings: parents already contain their children.
    if (!pieces.some(piece=>piece.includes(body))) pieces.push(text);
  }
  const title=pieces[0]?.split('\n')[0]??'';
  const bodies=pieces.map(piece=>piece.slice(piece.indexOf('\n')+1).trim()
    .replace(/^## (?:Opening|[^\n]*\(continued \d+\))\n+/,''));
  const joined=title+'\n\n'+bodies.join('\n\n');
  // Normalized page breaks never change an executable fence/marker contract.
  return expand(joined).replace(/(<!--[^\n]* BEGIN -->)\n+(?=```)/g,'$1\n').replace(/```\n+(?=<!--[^\n]* END -->)/g,'```\n');
}
