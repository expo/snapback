import {readFileSync} from 'node:fs';
export const wasm=readFileSync(new URL('../../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
export const backend=JSON.parse(readFileSync(new URL('../chat-schema.json',import.meta.url),'utf8'));
backend.schema.delivery=[{fingerprint:'fixture:messages',table:'messages',group:'conversationId',position:'at',mutation:'delivered',args:['conversation','from','through']}];
backend.schema.tables.messages.indexes.byDelivery={components:[{Column:'conversationId'},{Column:'at'}],unique:true};
const events=[{table:'conversations',id:'c1',title:'General',creatorId:'dev:alice'},
 {table:'memberships',id:'m1',conversationId:'c1',principal:'dev:alice',role:'admin',joinedAt:1},
 {table:'messages',id:'m',conversationId:'c1',authorId:'dev:alice',body:'confirmed',at:41,editedAt:null,photo:null}]
 .map(({table,...data})=>({table,id:data.id,kind:'put',data}));
export const snapshot={op:'apply',first:true,page:{snapshot:true,generation:1,events,held:{messages:[['c1']]},watermark:1,more:false}};
