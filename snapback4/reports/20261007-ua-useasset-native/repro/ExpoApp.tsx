import React, {useEffect} from 'react';
import {Text,View,Image,Platform} from 'react-native';
import {AppProvider,useAuth,useAsset,useQuery,useClient,useLink} from 'snapback4/react';
import {createApp} from 'snapback4/app';
import {nativeDevice,nativeAvailable} from 'snapback4-expo';
import {api} from './snapback/generated/api';
import config from './ua-config.json';
const originalFetch=globalThis.fetch;
const mode=(config as typeof config & {mode?:string}).mode??'ordinary';
const run=(__DEV__?'debug-r2-':'release-r2-')+mode;
const trace=(event:string,fields:object={})=>{console.log('UA',event,fields);void originalFetch(config.url+'/ua-log',{method:'POST',body:JSON.stringify({run,event,...fields})}).catch(()=>{});};
(globalThis as any).uaTrace=trace;
const fetcher:typeof fetch=async (input,init)=>{
 const uri=String(input),headers=new Headers(init?.headers);trace('fetch',{uri,headers:[...headers.keys()],bearer:headers.has('authorization'),range:headers.get('range')});
 if(mode==='opaque-headers'&&uri.includes('/assets/'))await new Promise(resolve=>setTimeout(resolve,6200));
 if(mode==='opaque-headers-wait'&&uri.includes('/assets/'))await new Promise(resolve=>setTimeout(resolve,16200));
 try {const response=await originalFetch(input,init);trace('fetch-response',{uri,status:response.status}); // Do not initialize Expo's unused lazy body stream before freezing.
 if(response.ok&&uri.includes('/assets/')){
  if(mode.startsWith('constructor')||mode.startsWith('conversion'))response.blob=async function(this:Response){const buffer=await this.arrayBuffer();if(mode.startsWith('conversion'))throw Error('UA injected native conversion failure');return new Blob([buffer]);};
  if(mode==='opaque-body-wait'){const blob=response.blob;response.blob=async function(this:Response){await new Promise(resolve=>setTimeout(resolve,16200));return blob.call(this);};}
  if(mode.endsWith('-sealed'))Object.seal(response);
  if(mode.endsWith('-frozen'))Object.freeze(response);
 }
 return response;}catch(e){trace('fetch-error',{uri,message:String(e)});throw e;}
};
let heldRetention=false;
const device={open:async (...args:any[])=>{const core=await (nativeDevice.open as any)(...args);return {...core,call:async (req:any)=>{if(['asset_home','meta','set_meta'].includes(req.op))trace('native-call',{op:req.op,key:req.key});if(mode==='stall-retention'&&req.op==='asset_home'&&!heldRetention){heldRetention=true;trace('retention-hold');await new Promise(resolve=>setTimeout(resolve,6200));trace('retention-resumed');}const result=await core.call(req);return result;}};}};
const app=createApp({url:config.url,device,fetch:fetcher,assets:{keep:'viewed',maxBytes:1000000}});
void app.ready.then(async()=>{trace('app-ready',{state:app.auth.state,native:nativeAvailable(),platform:Platform.OS});const login=await app.auth.login('ua@example.test','ua-password-123');trace('login',{ok:login.ok});});
const previous=(globalThis as any).ErrorUtils?.getGlobalHandler();(globalThis as any).ErrorUtils?.setGlobalHandler((error:any,fatal:boolean)=>{trace('global-error',{message:String(error),stack:error?.stack,fatal});previous?.(error,fatal);});
export function App(){return <AppProvider app={app}><View style={{padding:50}}><Account/></View></AppProvider>;}
function Account(){const auth=useAuth();return auth.state==='signed-in'?<History/>:<Text>{auth.state}</Text>;}
function History(){const result=useQuery(api.history,{});const link=useLink();useEffect(()=>trace('history',{result,link}),[result,link]);return <View><Text>UA ordinary image · {run} · {link}</Text>{'data'in result&&result.data.map(row=><Photo key={row.id} row={row}/>)}</View>;}
function Photo({row}:any){const asset=useAsset(row.photo.id),client=useClient();useEffect(()=>trace('asset-state',{asset,link:client.link(),viewer:client.viewer(),source:client.assetSource(row.photo.id).uri}),[asset]);return <View><Text>{row.body}</Text><Text>{JSON.stringify(asset)}</Text>{asset.status==='ready'&&<Image source={{uri:asset.url}} style={{width:256,height:256}} onLoad={()=>trace('image-load')} onError={e=>trace('image-error',{error:e.nativeEvent.error})}/>}</View>;}
