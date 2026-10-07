import {useEffect} from 'react';
import {AppProvider,useAuth,useQuery,useAsset} from 'snapback4/react';
import {createApp} from 'snapback4/app';
import {webDevice} from 'snapback4/web';
import {api} from '../snapback/generated/api';
import config from '../../config.json';
const trace=(event,fields={})=>{globalThis.uaEvents??=[];globalThis.uaEvents.push({event,...fields});void fetch(config.url+'/ua-log',{method:'POST',body:JSON.stringify({run:'web-fixed',event,...fields})})};
const app=createApp({url:config.url,device:webDevice(),assets:{keep:'viewed',maxBytes:1000000}});
void app.ready.then(async()=>{const r=await app.auth.login('ua@example.test','ua-password-123');trace('login',{ok:r.ok})});
export function App(){return <AppProvider app={app}><Account/></AppProvider>}
function Account(){const auth=useAuth();return auth.state==='signed-in'?<History/>:<p>{auth.state}</p>}
function History(){const rows=useQuery(api.history,{});return <main>{'data'in rows&&rows.data.map(row=><Photo key={row.id} row={row}/>)}</main>}
function Photo({row}){const a=useAsset(row.photo.id);useEffect(()=>trace('asset-state',{asset:a}),[a]);return <div>{row.body}<pre>{JSON.stringify(a)}</pre>{a.status==='ready'&&<img src={a.url} onLoad={()=>trace('image-load')} onError={()=>trace('image-error')}/>}</div>}
