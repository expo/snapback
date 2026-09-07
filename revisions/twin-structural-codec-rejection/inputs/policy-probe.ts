import { writeFileSync } from 'node:fs';
import { legacy } from './legacy-probe.ts';
import { validateTypedValue, validateWriteRow, rowFromWire, valueFromWire, assertValue, wireJson } from '@source/snapback2/packages/evaluator/src/value-runtime.ts';
import { canonicalProgramJson, canonicalSchemaJson, canonicalRuleJson } from '@source/snapback2/packages/evaluator/src/certificate-identity.ts';
import { RowImage } from '@source/snapback2/packages/evaluator/src/row-image.ts';
import contract from '@source/snapback2/crates/snapback2-core/ir-contract.json';
const own=(x:any)=>JSON.parse(x), id='s2id-00000000000000000000000000000000-0000000000000001';
const asset={Map:{id:{String:id},width:{Int:1},height:{Int:2}}};
const snapshot=(v:any):any=>{
 if(v===undefined)return {type:'undefined'};
 if(typeof v==='number'&&!Number.isFinite(v))return {type:'number',value:String(v)};
 if(Object.is(v,-0))return {type:'number',value:'-0'};
 if(typeof v==='bigint')return {type:'bigint',value:String(v)};
 if(v===null||typeof v!=='object')return v;
 if(Array.isArray(v))return {arrayLength:v.length,entries:Object.keys(v).map(k=>[k,snapshot(v[k as any])])};
 return {objectPrototype:Object.getPrototypeOf(v)===null?'null':Object.getPrototypeOf(v)===Object.prototype?'Object':'other',entries:Object.keys(v).map(k=>[k,snapshot(v[k])])};
};
const cases:any[]=[];
function run(name:string,input:any,body:()=>any){const before=snapshot(input);let output;
 try{output={value:snapshot(body())};}catch(e:any){output={error:{name:e.name,code:e.code,path:e.path,message:e.message}};}
 cases.push({name,input:before,...output,inputAfter:snapshot(input)});
}
const types:any[]=['Id','Principal','Int','Time','Bool','Scalar','Cursor',{Text:{max:2}},{Text:{max:2,min:1,format:'handle'}},{Text:{max:100,format:'url'}},{Bytes:{max:1}},{Json:{max_bytes:20}},{Enum:{variants:['yes']}},{Decimal:{scale:2}},{Money:{currency:'USD',scale:2}},{Ref:{table:'t'}},{Image:{max:1}},{Video:{max:1}},{Optional:{Text:{max:2}}},{List:{of:'Int',max:2}},{List:{of:null,max:2}},{List:{of:{Optional:{Image:{max:1}}},max:2}},{Optional:{List:{of:{Text:{max:2,min:1,format:'handle'}},max:2}}},null,{}, {Unexpected:1}];
const values:any[]=['Null',{Id:'x'},{Id:contract.systemPrincipalId},{String:'yes'},{String:''},{String:'a b'},{String:'A'},{String:'https://a\u0085'},{String:'https://a'},{String:'\ud800'},{String:'\u0001'},{String:'💠'},{Int:0},{Int:Number.MAX_SAFE_INTEGER},{Int:Number.MAX_SAFE_INTEGER+1},{Bool:true},{Bytes:'ab'},{Bytes:'AB'},{Map:{Bytes:{String:'ab'}}},asset,{Map:{...asset.Map,extra:'Null'}},{Array:[asset,asset]},{Array:[{Id:contract.systemPrincipalId},{Int:0.5}]},{Array:[{String:'bad'},{Id:contract.systemPrincipalId}]},{Array:new Array(2)}, {Array:[undefined]},own('{"Row":{"__proto__":"Null","💠":{"String":"x"},"":"Null"}}'),{},null,undefined];
for(let i=0;i<types.length;i++)for(let j=0;j<values.length;j++)for(const fanout of [false,true])run(`typed:${i}:${j}:${fanout}`,{type:types[i],value:values[j],fanout},()=>validateTypedValue(types[i],values[j],'arg x',fanout));
for(let j=0;j<values.length;j++)run(`shape:${j}`,values[j],()=>assertValue(values[j],'shape'));
const wireValues:any[]=[undefined,null,true,0,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,'x','\ud800','\u0001',contract.systemPrincipalId,{Bytes:'ab'}, {Bytes:'AB'},{id,width:2,height:3},{id,width:0,height:3},[null,'x'],new Array(2),own('{"__proto__":null,"💠":1,"":2}')];
const fail=(path:string,detail:string):never=>{throw new TypeError(`${path}: ${detail}`);};
for(let i=0;i<types.length;i++)for(let j=0;j<wireValues.length;j++)run(`wire:${i}:${j}`,{type:types[i],value:wireValues[j]},()=>valueFromWire(types[i],wireValues[j],'rows.t.value',fail));
const columns=own('{"id":"Id","text":{"Text":{"max":2}},"optional":{"Optional":{"Text":{"max":2}}},"__proto__":{"Optional":{"Text":{"max":2}}}}');
const schema={tables:{t:{columns,indexes:{byId:{components:[{Column:'id'}],unique:true}},rules:{read:'Public',insert:'Allow',update:'Allow',delete:'Allow'},constraints:[],retain:'until-revoked'}},maintains:[]};
const wireRows:any[]=[{id:'x',text:'ok'},{id:'x',text:'ok',optional:null}, {id:'x',text:'ok',optional:undefined},{id:'x'}, {text:'bad',id:contract.systemPrincipalId},{id:contract.systemPrincipalId,text:'bad'}, {bad:1,text:'bad'},{text:'bad',bad:1},own('{"id":"x","text":"ok","__proto__":"p"}'),{},null,[],undefined];
for(let i=0;i<wireRows.length;i++){
 run(`row-wire:${i}`,wireRows[i],()=>rowFromWire(schema,'t',wireRows[i],fail));
 run(`image-wire:${i}`,wireRows[i],()=>{const image=RowImage.fromWire(schema,'t',wireRows[i],fail);return {tagged:image,wire:RowImage.wire(image),digest:RowImage.digest(image)};});
}
for(let j=0;j<values.length;j++)run(`write-row:${j}`,values[j],()=>validateWriteRow(schema,'t',values[j]));
const frozen=Object.freeze({Row:{id:{Id:'x'},text:{String:'ok'}}});
run('image-frozen-custody',frozen,()=>{const a=RowImage.prepare(schema,'t',frozen as any);const same=RowImage.prepare(schema,'t',a as any);frozen.Row.text.String='no';return {a,wire:RowImage.wire(a),same:a===same};});
const program=(domain:any)=>({name:'q',kind:'Query',args:{},body:[{For:{binding:'r',domain,body:[]}}]});
for(const domain of [{Unknown:{z:1,a:2}}, {Unknown:'x'},'x',[{z:1,a:2}],{},[],null,undefined,{toString:{x:1}}])run('domain:'+JSON.stringify(snapshot(domain)),domain,()=>canonicalProgramJson(program(domain)));
for(const c of ['Text','List','Image','Video','Optional','Json','Enum','Money','Unknown'])for(const data of [undefined,null,{}, {max:2,min:0,format:null}, {max:2,min:1,format:'handle'},{max:2,min:-1,format:'bad'},{of:{Text:{max:2,min:1}},max:2},{max:2,once:null},{max:2,once:false},{max:2,once:true},{z:1,a:2}]){
 const t={[c]:data};run('canonical-arg:'+c+':'+cases.length,t,()=>canonicalProgramJson({name:'q',kind:'Query',args:{x:t},body:[]}));
 run('canonical-column:'+c+':'+cases.length,t,()=>canonicalSchemaJson({...schema,tables:{t:{...schema.tables.t,columns:{id:'Id',x:t}}}}));
}
const scan={site:'s',table:'t',index:'byId',prefix:[{Scalar:{Literal:{Id:'x'}}}],order:'Asc',take:{Literal:1},after:null,before:null,range:null};
for(const take of [{Arg:{name:'x',max:1,extra:1}}, {}, null,undefined,{Literal:1}])for(const prefix of [[{Bad:0}],null,[],[{Scalar:{Literal:'Null'}}]]){
 const p={name:'q',kind:'Query',args:{},body:[{Return:{Scan:{...scan,take,prefix}}}]};run('scan-order:'+cases.length,p,()=>canonicalProgramJson(p));
}
for(const kind of ['Const','Return','toString','constructor','Unknown'])for(const value of [null,{},[],{value:{Literal:'Null'},extra:true}]){const p={name:'q',kind:'Query',args:{},body:[{[kind]:value}]};run('statement-parent:'+cases.length,p,()=>canonicalProgramJson(p));}
for(const value of [undefined,null,0,'x',{},[],[null]]) {
 for(const field of ['args','body']) {const p={name:'q',kind:'Query',args:{},body:[],[field]:value};run('program-field:'+field+':'+cases.length,p,()=>canonicalProgramJson(p));}
 for(const field of ['tables','schedules','maintains','channels','auth','effects']) {const p={tables:{},maintains:[],[field]:value};run('schema-field:'+field+':'+cases.length,p,()=>canonicalSchemaJson(p));}
 for(const type of ['Rule','Column','Constraint']){
  const p={...schema,tables:{t:{...schema.tables.t,...(type==='Rule'?{rules:value}:type==='Column'?{columns:{id:'Id',x:value}}:{constraints:value})}}};
  run('schema-parent:'+type+':'+cases.length,p,()=>canonicalSchemaJson(p));
 }
}
writeFileSync(process.argv[2],JSON.stringify({legacy,policies:cases}));
console.log(JSON.stringify({policies:cases.length,legacyCanonical:legacy.canonical.length,attribution:'native checked fixtures canonicalized; malformed controls synthetic; no new native execution'}));
