import {census,awaitBoundary} from '../../../packages/snapback4/test/delivery-fault-instrument.mjs';
import {recipe,fixtureIndex,required,absorbs} from '../../../packages/snapback4/test/delivery-fault-recipes.mjs';
import {writeFileSync} from 'node:fs';
const sites=census();
const seal=sites.map((s,index)=>({index,id:s.id,recipe:recipe(index),classification:required.has(fixtureIndex(index))?'required':'optional',absorbs:absorbs.has(fixtureIndex(index))}));
writeFileSync('packages/snapback4/test/delivery-await-boundary.json',JSON.stringify(awaitBoundary(),null,2)+'\n');
writeFileSync('packages/snapback4/test/delivery-fault-sites.json','[\n'+seal.map(s=>'  '+JSON.stringify(s)).join(',\n')+'\n]\n');
console.log(`await seal: ${sites.length} classified delivery sites and recipes`);
