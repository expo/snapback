import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as candidate from './candidate-probe/inspection.ts';
import * as data from './candidate-probe/unicode-tables.ts';
const oracle = JSON.parse(readFileSync(new URL('./baseline-probe/oracle.json',import.meta.url),'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
const columns = data.PACKETS.map((text,i) => {
  const reader = new candidate.PacketReader(text,data.COLUMN_LENGTHS[i]);
  const values = Array.from({length:data.COLUMN_LENGTHS[i]},()=>reader.next());reader.finish();return values;
});
let integers=0,elements=0;
assert.equal(columns.length,oracle.columns.length);
for(let i=0;i<columns.length;i++) {
  assert.equal(columns[i].length,oracle.columns[i].length);
  for(let j=0;j<columns[i].length;j++) {assert.equal(columns[i][j],oracle.columns[i][j],`column ${i}:${j}`);integers++;}
}
for(const [name,old] of Object.entries(oracle.arrays)) {
  assert.equal(candidate[name].constructor.name,old.type);assert.equal(candidate[name].length,old.values.length);
  for(let i=0;i<old.values.length;i++) {assert.equal(candidate[name][i],old.values[i],`${name}:${i}`);elements++;}
}
for(const [name,expected] of Object.entries(oracle.constants)) assert.equal(candidate[name],expected,name);
const suffix = '// Pinned tables have <4096 rows:';
const before = readFileSync(new URL('./before-source/snapback2/packages/evaluator/src/unicode-tables.ts',import.meta.url),'utf8');
const after = readFileSync(new URL('./candidate-probe/production-decoder.ts',import.meta.url),'utf8');
assert.equal(after.slice(after.indexOf(suffix)),before.slice(before.indexOf(suffix)));
assert.equal(sha(readFileSync(new URL('./before-source/snapback2/packages/evaluator/src/unicode.ts',import.meta.url))),sha(readFileSync(new URL('./candidate-probe/unicode.ts',import.meta.url))));
const digest=createHash('sha256');
for(const text of data.PACKETS) {const bytes=Buffer.from(text,'base64'),size=Buffer.alloc(4);size.writeUInt32LE(bytes.length);digest.update(size).update(bytes);}
assert.equal(digest.digest('hex'),data.PACKET_DIGEST);
assert.notEqual(data.PACKET_DIGEST,candidate.TABLE_DIGEST);
const pack=bytes=>Buffer.from(bytes).toString('base64');
const read=(text,n)=>{const r=new candidate.PacketReader(text,n),v=Array.from({length:n},()=>r.next());r.finish();return v;};
assert.deepEqual(read(pack([8,0,127,128,1,1]),4),[0,127,128,1]);
assert.deepEqual(read(pack([9,10,3]),4),[10,8,6,4]);
assert.deepEqual(read(pack([9,0,0]),4),[0,0,0,0]);
assert.deepEqual(read(pack([2,6]),1),[6]);
const invalids=[
 ['zero count',[0],1],['too many values',[4,1,2],1],['one-value affine',[3,0,0],1],
 ['truncated varint',[2,128],1],['overlong integer',[130,0,0],1],['u32 overflow',[255,255,255,255,16],1],
 ['fifth-byte continuation',[128,128,128,128,128],1],['missing affine step',[5,1],2],
 ['negative endpoint',[5,0,1],2],['oversized endpoint',[5,255,255,18,2],2],
 ['oversized literal',[2,255,255,18],1],['trailing byte',[2,0,0],1],['extra packet',[2,0,2,1],1]
];
for(const [name,bytes,n] of invalids) assert.throws(()=>read(pack(bytes),n),TypeError,name);
for(const [name,text] of [['bad alphabet','!gA='],['missing padding','AgA'],['extra padding','AgA=='],['nonzero padding','AgB=']])
 assert.throws(()=>read(text,1),TypeError,name);
const result={equal:true,columnIntegers:integers,typedArrayElements:elements,columns:columns.map(xs=>({length:xs.length,max:Math.max(...xs)})),tableRows:data.TABLE_ROWS,packetBytes:data.PACKETS.map(s=>Buffer.from(s,'base64').length),packetDigest:data.PACKET_DIGEST,legacyDigest:candidate.TABLE_DIGEST,lookupSuffixSha256:sha(after.slice(after.indexOf(suffix))),validPacketControls:4,malformedPacketControls:invalids.length+4,finalTypedArrayBytes:Object.values(oracle.arrays).reduce((n,x)=>n+4*x.values.length,0),temporaryCompositionPermutationBytes:2*data.TABLE_ROWS[1],scope:'instrumented copied decoder; not production exports, latency, resident or native evidence'};
writeFileSync(new URL('./comparison-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
