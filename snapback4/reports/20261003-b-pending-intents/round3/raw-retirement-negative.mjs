import fs from 'node:fs';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
let count=0;
const mode = process.env.RETIREMENT_MUTATION ?? 'both';
const transform = source => {
  const text = String(source);
  const next = mode === 'receipt' ? text.replace('entry && !entry.retired && entry.owner', 'entry && entry.owner')
    : mode === 'pending' ? text.replace('!entry.done && !entry.retired && entry.owner', '!entry.done && entry.owner')
    : text.replaceAll('!entry.retired && ', '');
  if (next === text) throw Error('retirement mutation missed: ' + mode);
  count++; return next;
};
registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);return url.endsWith('/snapback4/packages/snapback4/dist/client.js')?{...result,source:transform(result.source)}:result;}});
const replace=(path,body)=>{if(!String(path).endsWith('/snapback4/packages/snapback4/src/client.ts'))return body;const text=transform(body);return typeof body==='string'?text:Buffer.from(text)};
const read=fs.promises.readFile.bind(fs.promises),readSync=fs.readFileSync.bind(fs);
fs.promises.readFile=async(path,...args)=>replace(path,await read(path,...args));
fs.readFileSync=(path,...args)=>replace(path,readSync(path,...args));syncBuiltinESMExports();
process.on('exit',()=>{if(count)console.log('MUTATION remove permanent raw retirement filter '+mode+', loads='+count)});
