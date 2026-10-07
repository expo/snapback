import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, FlatList, Keyboard, KeyboardAvoidingView } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { MessageBubble } from './ui/src/MessageBubble';
import { ReceiptTicks } from './ui/src/ReceiptTicks';
import { SearchBar } from './ui/src/SearchBar';
import { ChatListRow } from './ui/src/ChatListRow';
import { CommittedFlatList, configuration, observe, bodyHash, mediaCallbacks, useCommittedScreen } from 'clique-native-observer';
const origin = 'http://127.0.0.1:49491';
const ObservationFloodSize = 10_001;
const db = SQLite.openDatabaseSync('reference.db');
db.execSync('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
const saved: any = db.getFirstSync('SELECT value FROM state WHERE id=1');
let model: any = saved ? JSON.parse(saved.value) : { session: null, rows: [], queue: [], ordinary: {}, consumed: false, ordinal: 0 };
if (model.session?.fault === 'volatile-outbox') { const ids = new Set(model.queue.map((r:any)=>r.messageId)); model.rows = model.rows.filter((r:any)=>!ids.has(r.messageId)); model.queue = []; }
const persist = () => db.runSync('INSERT OR REPLACE INTO state VALUES (1,?)', JSON.stringify(model));
const cfg = configuration();
async function api(route:string, data?:any) {
 const response = await fetch(origin + route, { method: data ? 'POST' : 'GET', headers: { 'Content-Type':'application/json', ...(model.session ? {Authorization:'Bearer '+model.session.token} : {}) }, ...(data ? {body:JSON.stringify(data)}:{}) });
 if (!response.ok) throw Error(String(response.status)); return response.json();
}
const Button = ({id,onPress,children}:any)=><Pressable testID={id} onPress={onPress} style={{padding:10,backgroundColor:'#cee',margin:2}}><Text>{children}</Text></Pressable>;
const RetainedStoreObservation = ({route,conversationId,rows}:any) => {
 useCommittedScreen(route,conversationId,rows.map((r:any)=>({messageId:r.messageId,bodyHash:bodyHash(r.body),receipt:r.receiptState??'pending'})));
 return null;
};
export default function App() {
 const [epoch, setEpoch] = useState(0), [route,setRoute]=useState(model.session?'chats':'auth');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[body,setBody]=useState(''),[token,setToken]=useState('');
 const [viewer,setViewer]=useState<any>(null),[error,setError]=useState('');
 const [online,setOnline]=useState(true);
 const list=useRef<FlatList>(null);
 const stalledFloodStarted=useRef(false);
 const applicationViewabilityPairs=useRef([{viewabilityConfig:{itemVisiblePercentThreshold:50},onViewableItemsChanged:()=>{}}]).current;
 const notify=()=>setEpoch(x=>x+1);
 const fault=model.session?.fault;
 const ready=()=>observe('ready',{principal:model.session.principal,origin,authenticationRestored:true,build:cfg?.build,development:__DEV__});
 useEffect(()=>{ if(model.session) ready(); },[]);
 useEffect(()=>{
  if(fault!=='stalled-writer'||cfg?.stalledWriterControl!==true||stalledFloodStarted.current)return;
  stalledFloodStarted.current=true;
  for(let index=0;index<ObservationFloodSize;index++)observe('screen',{route:'conversation',conversationId:'stalled-writer-control',rows:[]});
 },[fault]);
 useEffect(()=>{
  let busy=false;
  const timer=setInterval(async()=>{
   if (!model.session || busy) return; busy=true;
   try {
    // Fresh normal auth after server restart; credentials live only in this fixture app's private store.
    model.session = {...model.session,...await api('/login',model.credentials)};
    const conversations=await api('/conversations'); model.conversation=conversations[0];
    for(const row of [...model.queue]) {
     const sent=await api('/send',{...row,conversationId:model.conversation.conversationId});
     model.queue=model.queue.filter((x:any)=>x.messageId!==row.messageId);
     observe('write',{ordinal:row.ordinal,operationId:row.messageId,messageId:sent.messageId,bodyHash:bodyHash(row.body),state:'settled'});
     persist();
    }
    const page=await api('/history?conversationId='+encodeURIComponent(model.conversation.conversationId));
    const newRows=[...page.rows,...model.queue];
    const changed=JSON.stringify(model.rows)!==JSON.stringify(newRows)||model.consumed!==!!page.rows.find((r:any)=>r.once)?.consumed;
    setOnline(true);model.rows=newRows;model.consumed=!!page.rows.find((r:any)=>r.once)?.consumed;persist();if(changed)notify();
   } catch {setOnline(false);} finally {busy=false;}
  },400);
  return()=>clearInterval(timer);
 },[]);
 useLayoutEffect(()=>{if(route==='conversation' && model.consumed){const r=model.rows.find((r:any)=>r.once);if(r)observe('media',{messageId:r.messageId,assetId:r.assetId,event:'consumed',width:0,height:0,provenance:null});}},[route,epoch]);
 const searchActive=token.trim().length>0;
 const searchRows=fault==='newest-first'?[...model.rows].reverse():model.rows;
 const results=searchActive?searchRows.filter((r:any)=>r.body.includes(token)):[];
 useLayoutEffect(()=>{if(route==='search')observe('search',{token,resultIds:results.map((r:any)=>r.messageId),openedConversationId:null});},[route,token,epoch]);
 async function login(){try{model.credentials={email,password};model.session=await api('/login',model.credentials);model.conversation=(await api('/conversations'))[0];persist();ready();setRoute('chats');}catch{setError('Sign-in failed');}}
 async function open(row:any){
  if(row.once && model.consumed && fault==='delayed-refusal'){setTimeout(()=>{observe('media',{messageId:row.messageId,assetId:row.assetId,event:'denied',width:0,height:0,provenance:null});setError('Consumed');},1500);return;}
  if(row.once && model.consumed){if(['elsewhere-viewonce','bright-viewonce'].includes(fault))setViewer({row,bytes:model.onceBytes});observe('media',{messageId:row.messageId,assetId:row.assetId,event:'denied',width:0,height:0,provenance:null});setError('Consumed');if(fault==='stale-viewonce')setViewer({row,bytes:model.onceBytes});if(fault==='async-viewonce')setTimeout(()=>setViewer({row,bytes:model.onceBytes}),2500);return;}
  try{
   let bytes=model.ordinary[row.assetId];
   if(!bytes)bytes=(await api('/asset?conversationId='+model.conversation.conversationId+'&id='+row.assetId)).bytes;
   if(row.once){model.consumed=true;if(['stale-viewonce','async-viewonce','pre-reopen-viewonce','elsewhere-viewonce','bright-viewonce'].includes(fault))model.onceBytes=bytes;}
   else model.ordinary[row.assetId]=bytes;
   persist();setViewer({row,bytes});
  }catch{setError('Media unavailable');observe('media',{messageId:row.messageId,assetId:row.assetId,event:'error',width:0,height:0,provenance:null});}
 }
 function close(){if(viewer?.row.once)observe('media',{messageId:viewer.row.messageId,assetId:viewer.row.assetId,event:'consumed',width:0,height:0,provenance:null});setViewer(null);notify();}
 function send(){if(!body)return;const ordinal=++model.ordinal;const messageId='local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);const row={messageId,body,ordinal,author:model.session.principal,receiptState:'pending',orderKey:[1e9+ordinal]};model.queue.push(row);model.rows.push(row);persist();observe('write',{ordinal,operationId:messageId,messageId,bodyHash:bodyHash(body),state:'pending'});setBody('');Keyboard.dismiss();notify();setTimeout(()=>fault==='newest-first'?list.current?.scrollToOffset({offset:0,animated:false}):list.current?.scrollToEnd({animated:false}),150);}
 const renderRow=({item:r}:any)=><View>
   {fault==='collapsed-receipt' && r.body.includes(':') ? <Pressable testID="sm-convo-bubble" accessible={false} accessibilityLabel="Message" accessibilityValue={{text:r.messageId}} style={{padding:12,backgroundColor:'#dce6ff',borderRadius:12}}><Text>{r.body}</Text><View accessible accessibilityLabel="Message status"><View accessibilityElementsHidden><ReceiptTicks pending={r.receiptState==='pending'} state="sent"/></View></View></Pressable> : <MessageBubble messageId={r.messageId} isMine={r.author===model.session.principal} text={r.body} timestamp="12:00" receipt={r.receiptState==='pending'?'sent':fault==='wrong-receipts'?'read':r.receiptState} receiptPending={r.receiptState==='pending'} viewOnce={r.once} viewOnceOpened={model.consumed && !['stale-viewonce','async-viewonce','elsewhere-viewonce','bright-viewonce','delayed-refusal'].includes(fault)} mediaUri={r.assetId&&!r.once?'data:image/png;base64,'+(model.ordinary[r.assetId]??''):undefined} onPressMedia={()=>open(r)}/>} 
   {r.once&&model.consumed?<Text testID="sm-convo-error">Consumed</Text>:null}
  </View>;
 const listRows=fault==='newest-first'?[...model.rows].reverse():model.rows;
 // This false event is deliberately confined to the negative-control reference.
 useEffect(()=>{if(viewer && fault==='placeholder' && !online && !viewer.row.once)observe('media',{messageId:viewer.row.messageId,assetId:viewer.row.assetId,event:'load',width:192,height:128,provenance:null});},[viewer,online]);
 return <KeyboardAvoidingView behavior="padding" style={{flex:1,paddingTop:65,paddingBottom:30,backgroundColor:'white'}}>
  {route==='auth'?<View><TextInput testID="sm-auth-email" autoCapitalize="none" autoCorrect={false} value={email} onChangeText={setEmail} style={{height:50,borderWidth:1}}/><TextInput testID="sm-auth-password" secureTextEntry autoCapitalize="none" autoCorrect={false} value={password} onChangeText={setPassword} style={{height:50,borderWidth:1}}/><Button id="sm-auth-submit" onPress={login}>Sign in</Button></View>:<>
   <View style={{flexDirection:'row'}}><Button id="sm-nav-chats" onPress={()=>{setRoute('chats');setError('');}}>Chats</Button><Button id="sm-nav-search" onPress={()=>setRoute('search')}>Search</Button><Button id="sm-nav-back" onPress={()=>{setRoute('chats');setError('');}}>Back</Button></View>
   {route==='chats'&&model.conversation?<ChatListRow title="Bob" identity="dm:bob" onPress={()=>setRoute('conversation')}/>:null}
   {route==='search'?<SearchBar value={token} onChangeText={setToken} results={results.map((r:any)=>({id:r.messageId,title:r.body}))} onPressResult={()=>{Keyboard.dismiss();setRoute(fault==='navigation-claim'?'auth':'conversation');observe('search',{token,resultIds:results.map((r:any)=>r.messageId),openedConversationId:model.conversation.conversationId});}}/>:null}
   {route==='conversation'?<View testID="sm-conversation" accessible={false} accessibilityValue={{text:model.conversation.conversationId}} style={{flex:1}}><TextInput testID="sm-convo-input" value={body} onChangeText={setBody} style={{height:42,borderWidth:1}}/><Button id="sm-convo-send" onPress={send}>Send</Button>{fault==='scroll-no-screen'?<><RetainedStoreObservation route={route} conversationId={model.conversation?.conversationId} rows={model.rows}/><FlatList ref={list} data={model.rows} keyExtractor={(r:any)=>r.messageId} initialNumToRender={5} windowSize={3} onLayout={()=>setTimeout(()=>list.current?.scrollToEnd({animated:false}),100)} renderItem={renderRow}/></>:<CommittedFlatList listRef={list} data={listRows} inverted={fault==='newest-first'} viewabilityConfigCallbackPairs={fault==='newest-first'?applicationViewabilityPairs:undefined} keyExtractor={(r:any)=>r.messageId} observation={{route,conversationId:fault==='wrong-conversation'?'wrong-conversation':model.conversation?.conversationId,row:(r:any)=>({messageId:r.messageId,bodyHash:bodyHash(r.body),receipt:fault==='wrong-receipts'&&r.receiptState!=='pending'?'read':r.receiptState??'pending'})}} initialNumToRender={5} windowSize={3} renderItem={renderRow}/>}</View>:null}
  </>}
  {error?<Text testID="sm-convo-error">{error}</Text>:null}
  {saved && fault==='pre-reopen-viewonce' && model.onceBytes?<Image source={{uri:'data:image/png;base64,'+model.onceBytes}} style={{position:'absolute',width:1,height:1}} {...mediaCallbacks(model.rows.find((r:any)=>r.once).messageId,model.rows.find((r:any)=>r.once).assetId,'cache')}/>:null}
  {viewer?<View style={{position:'absolute',top:saved&&fault==='elsewhere-viewonce'?450:180,left:saved&&fault==='elsewhere-viewonce'?0:20,right:20,padding:10,backgroundColor:'white'}}>
   {fault==='placeholder' && !online&&!viewer.row.once?<View testID="sm-media-viewer-image" style={{width:288,height:192,backgroundColor:'#999'}}><Text>Image</Text></View>:<Image testID={saved&&viewer.row.once&&['elsewhere-viewonce','bright-viewonce'].includes(fault)?undefined:"sm-media-viewer-image"} accessible accessibilityRole="image" source={{uri:'data:image/png;base64,'+viewer.bytes}} style={{width:288,height:192,opacity:saved&&viewer.row.once&&fault==='bright-viewonce'?.75:1}} resizeMode="contain" {...(saved&&viewer.row.once&&['elsewhere-viewonce','bright-viewonce'].includes(fault)?{}:mediaCallbacks(viewer.row.messageId,viewer.row.assetId,viewer.row.once&&model.onceBytes?'cache':null))}/>}
   <Button id="sm-media-viewer-close" onPress={close}>Close</Button>
  </View>:null}
 </KeyboardAvoidingView>;
}
