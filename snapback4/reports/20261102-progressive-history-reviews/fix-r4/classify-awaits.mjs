import {readFileSync,writeFileSync} from 'node:fs';
const dir='packages/snapback4/test/';
const old=JSON.parse(readFileSync(dir+'delivery-fault-sites.json','utf8'));
const sites=old.map(s=>{const [file,owner]=s.id.split(':');return {file,owner,expression:s.id.slice(file.length+owner.length+2).replace(/#\d+$/,'')};});
const recipeSource=readFileSync(dir+'delivery-fault-recipes.mjs','utf8');
const fn=new Function('deliverySites',recipeSource.slice(recipeSource.indexOf('export function fixtureIndex'),recipeSource.indexOf('export function recipe')).replace('export function','function')+';return fixtureIndex;')(sites);
const mappings=old.map((s,i)=>[s.id,fn(i)]);
// The existing sync transport adds the negotiated acquisition fields only; its fault recipe is unchanged.
for(const entry of mappings) if(entry[0].startsWith('local.ts:syncRound:withReadSignal(')) entry[0]=entry[0].replace('...(requestedStore ? { store_id: requestedStore } : {}) }','...(requestedStore ? { store_id: requestedStore } : {}), ...acquisition }');
mappings.push(['local.ts:syncRound:loadBackend(doFetch, base, requestCredentials().headers, aborter.signal)#1',166]);
const start=recipeSource.indexOf('// Keep the existing fixture cases'),end=recipeSource.indexOf('export function recipe');
writeFileSync(dir+'delivery-fault-recipes.mjs',recipeSource.slice(0,start)+`// Keep recipes bound to semantic awaits when implementation moves between modules.\n// New awaits have no default; the metadata negotiation wait has its own recovery recipe.\nconst fixtureById = new Map(${JSON.stringify(mappings,null,2)});\nexport function fixtureIndex(index) {\n  const site = deliverySites[index], fixture = fixtureById.get(site?.id);\n  if (fixture === undefined) throw Error(\`unclassified awaited site \${site?.id}\`);\n  return fixture;\n}\n`+recipeSource.slice(end));
