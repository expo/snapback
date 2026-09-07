import { createRequire, registerHooks } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = dirname(fileURLToPath(import.meta.url)), root = out + '/source';
const prefix = out + '/final', hash = b => createHash('sha256').update(b).digest('hex');
const actual = createRequire(root+'/snapback2/packages/evaluator/package.json')('esbuild');
const previous = JSON.parse(readFileSync(out+'/baseline-byte-attribution.json','utf8'));
const manifest = JSON.parse(readFileSync(out+'/source-manifest.json','utf8'));
if (actual.version !== '0.25.9' || process.version !== 'v22.23.2') throw Error('pinned tools required');
export async function build(options) {
  if (options.stdin.contents !== previous.entry.join('\n')) throw Error('five roots changed');
  const before = Object.fromEntries(manifest.sources.filter(r => !r.symlink).map(r => {
    const bytes=readFileSync(root+'/'+r.path); if(hash(bytes)!==r.sha256) throw Error('unfrozen source '+r.path); return [r.path,bytes];
  }));
  const result=await actual.build(options), sources={};
  for (const input of Object.keys(result.metafile.inputs)) {
    if(input==='<stdin>') continue;
    const path=resolve(process.cwd(),input), name=relative(root,path), bytes=readFileSync(path);
    if(!before[name]?.equals(bytes)) throw Error('input not captured before build '+name);
    const copy=prefix+'-measured-sources/'+name; mkdirSync(dirname(copy),{recursive:true}); writeFileSync(copy,bytes,{flag:'wx'});
    sources[name]={sha256:hash(bytes),bytes:bytes.length,copy};
  }
  const bytes=result.outputFiles[0].contents;
  writeFileSync(prefix+'-entry.ts',options.stdin.contents,{flag:'wx'});
  writeFileSync(prefix+'-byte-bundle.mjs',bytes,{flag:'wx'});
  writeFileSync(prefix+'-metafile.json',JSON.stringify(result.metafile,null,2)+'\n',{flag:'wx'});
  writeFileSync(prefix+'-byte-attribution.json',JSON.stringify({node:process.version,esbuild:actual.version,entry:previous.entry,
    minified:bytes.length,gzip:gzipSync(bytes,{level:9}).length,sha256:hash(bytes),ceiling:66000,target:64000,sources,
    attribution:Object.values(result.metafile.outputs).flatMap(o=>Object.entries(o.inputs).map(([path,v])=>({path,bytes:v.bytesInOutput}))).sort((a,b)=>b.bytes-a.bytes)},null,2)+'\n',{flag:'wx'});
  return result;
}
const owner=pathToFileURL(root+'/snapback2/packages/snapback2/build.mjs').href;
registerHooks({resolve(specifier,context,next){return specifier==='esbuild'&&context.parentURL===owner?{url:import.meta.url,shortCircuit:true}:next(specifier,context);}});
