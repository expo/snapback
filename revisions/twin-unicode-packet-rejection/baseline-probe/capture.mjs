import * as tables from './inspection.ts';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const names = ['decomposition','composition','combining','folding','boundaries'];
const arrays = Object.fromEntries(names.map(name => [name,{ type:tables[name].constructor.name,values:Array.from(tables[name]) }]));
const result = {columns:tables.columns,arrays,constants:Object.fromEntries(['TABLE_DIGEST','MAX_NFD_SCALARS','MAX_DECOMPOSITION_DEPTH','MAX_LOOKUP_PROBES'].map(name => [name,tables[name]]))};
writeFileSync(new URL('./oracle.json',import.meta.url),JSON.stringify(result));
console.log(JSON.stringify({columns:tables.columns.map(x=>({length:x.length,max:Math.max(...x)})),arrays:Object.fromEntries(names.map(name=>[name,tables[name].length])),constants:result.constants}));
