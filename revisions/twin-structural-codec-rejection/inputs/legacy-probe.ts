import { readdirSync, readFileSync } from 'node:fs';
import { canonicalProgramJson, canonicalSchemaJson, canonicalRuleJson } from '@source/snapback2/packages/evaluator/src/certificate-identity.ts';
import { collectRefs, mapRowValues, purgeAnswerData } from '@source/snapback2/packages/snapback2/src/store/row-values.ts';
import { decodeDeliveryEnvelope, encodeDeliveryEnvelope, expandRows } from '@source/snapback2/packages/snapback2/src/offline-protocol.ts';
import { nullOnceMedia } from '@source/snapback2/packages/snapback2/src/store/asset-policy.ts';
import { assetIdsIn } from '@source/snapback2/packages/snapback2/src/store/byte-cache.ts';
const corpus=process.env.CORPUS!;
const attempt=(f:()=>unknown)=>{ try { return {value:f()}; } catch(e:any) {return {error:{name:e.name,code:e.code,path:e.path,message:e.message}};} };
const result:any={canonical:[],adverse:[],envelopes:[],answers:[]};
let first:any;
for (const name of readdirSync(corpus).filter(n=>n.endsWith('.json')).sort()) {
 const x=JSON.parse(readFileSync(`${corpus}/${name}`,'utf8')); first??=x;
 result.canonical.push({name,schema:attempt(()=>canonicalSchemaJson(x.schema)),program:attempt(()=>canonicalProgramJson(x.program))});
}
for (const name of readdirSync(`${corpus}/offline`).filter(n=>n.startsWith('envelope-')).sort()) {
 const x=JSON.parse(readFileSync(`${corpus}/offline/${name}`,'utf8'));
 result.envelopes.push({name,encoded:attempt(()=>encodeDeliveryEnvelope(x)),expanded:attempt(()=>expandRows(x))});
}
for (const variant of ['Text','List','Image','Video','Unknown']) for (const payload of [null,{}, {max:3,min:0}, {max:3,min:1,format:'handle'}, {max:3,format:null}, {max:3,extra:true}]) {
 const p={name:'q',kind:'Query',args:{x:{[variant]:payload}},body:[{Return:{Literal:'Null'}}]};
 result.adverse.push({kind:'arg',variant,payload,...attempt(()=>canonicalProgramJson(p))});
}
const p=structuredClone(first.program);
for (const [kind,data] of Object.entries<any>({Const:{name:'a',value:{Literal:{Int:1}}},Return:{Object:{'💠':{Literal:'Null'},'\ue000':{Literal:{Bytes:'ab'}}}},Unknown:{z:1,a:2}})) {
 for (const item of [data,{...data,unexpected:1}]) result.adverse.push({kind,item,...attempt(()=>canonicalProgramJson({...p,body:[{[kind]:item}]}))});
}
for (const r of [{Public:{reason:'test',extra:1}},{Exists:{table:'t',index:'i',key:[{Literal:{Map:{z:'Null',a:{Int:1}}}}],provenance:null}}, {Unknown:{z:1,a:2}}]) result.adverse.push({rule:r,...attempt(()=>canonicalRuleJson(r))});
const ref=(id:string)=>({$row:{table:'t',id}}), esc=(x:any)=>({$row:{$value:x}});
const asset={id:'s2id-00000000000000000000000000000000-0000000000000001',width:2,height:3};
const values=[null,'text',3,[],{},ref('one'),[ref('one'),ref('one'),ref('two')],esc({$row:{table:'literal',id:'x'}}),esc({x:ref('one'),nest:[esc({$row:{foo:ref('two')}})]}),JSON.parse('{"__proto__":{"x":2},"2":null,"10":"yes","💠":1,"":2}'),{asset,inline:[asset,{...asset,extra:true}]}];
for (const value of values) result.answers.push({value,refs:collectRefs(value),mapped:mapRowValues(value,r=>({resolved:r})),purged:purgeAnswerData(value,{table:'t',id:'one'}),media:nullOnceMedia(value,new Set([asset.id])),assets:[...assetIdsIn(value)]});
const sample=JSON.parse(readFileSync(`${corpus}/offline/envelope-point-hit.json`,'utf8'));
for (const data of [{$row:{table:'unknown',id:'missing'}},esc({x:{$row:{table:'unknown',id:'missing'}}}),{$row:{table:'t'}},{x:'\ud800'},{x:0.1},{x:undefined},[ref('one'),{$row:{}}]]) {
 result.adverse.push({kind:'wire-data',data,...attempt(()=>decodeDeliveryEnvelope({...sample,data,validator:'wrong'}))});
}
export const legacy = result;
