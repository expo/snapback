import React,{useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {useClient,usePage,useQuery} from 'snapback4/react';import {api} from './snapback/generated/api';import {PageLifetime} from './PageLifetime';
const Text=({children}:{children:React.ReactNode})=><span>{children}</span>;
function History({id}:{id:string}) {const client=useClient();
const lifetime=useMemo(()=>new PageLifetime(client,api.history,{conversation:id,c:null}),[client,id]);
const scope=useSyncExternalStore(lifetime.subscribe,lifetime.getSnapshot,lifetime.getSnapshot),historyOp=useMemo(()=>({...api.history}),[scope.epoch]);
const page=usePage(historyOp,{conversation:id});
 const [start,Start]=useState(0);const offset=Math.min(start,Math.max(0,page.items.length-40)),historyKeys=page.items.slice(offset,offset+40).map(({id,ordinal})=>({id,ordinal})).sort((a,b)=>a.ordinal-b.ordinal);
 useEffect(()=>()=>{void client.mutate(api.stopTyping,{conversation:id})},[client,id]);
return <>{historyKeys.map(key=><StableMessage key={`${scope.epoch}:${key.id}`} id={key.id}>{m=><Text>{m.text}</Text>}</StableMessage>)}</>;}
function StableMessage({id,children}:{id:string,children:(m:any)=>React.ReactNode}){const r=useQuery(api.quotedMessage,{id},{keep:false});return 'data'in r&&r.data&&!r.revalidating?<>{children(r.data)}</>:<Text>Message unavailable</Text>}
