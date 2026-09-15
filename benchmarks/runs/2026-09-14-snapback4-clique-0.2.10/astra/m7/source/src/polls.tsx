import React, { useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery } from 'snapback4/react';
import { api } from '../snapback/generated/api';
import { PollCompose, PollDisplay } from '../ui';
import { Button } from './common';
import { useApp } from './session';

export function CreatePoll({conversationId}: {conversationId:string}) {
  const {client,setError}=useApp();
  const [open,setOpen]=useState(false), [question,setQuestion]=useState(''),
    [options,setOptions]=useState(['','']), [busy,setBusy]=useState(false);
  return <View>
    <Button testID="sm-convo-create-poll" onPress={()=>setOpen(!open)}>{open?'Cancel poll':'Create poll'}</Button>
    {open && <PollCompose question={question} options={options} onChangeQuestion={setQuestion}
      onChangeOption={(i,t)=>setOptions(options.map((o,j)=>j===i?t:o))}
      onAddOption={()=>setOptions([...options,''])} onRemoveOption={i=>setOptions(options.filter((_,j)=>i!==j))}
      submitting={busy} onSubmit={async(question,options)=>{
        setBusy(true);setError('');
        try {
          const w=await client.mutate(api.polls.create,{messageId:randomUUID(),conversationId,question,options,optionKeys:options.map(()=>randomUUID())});
          if(w.state==='failed') throw Error(w.why.message);
          setQuestion('');setOptions(['','']);setOpen(false);
        } catch(e:any){setError(e.message);} finally{setBusy(false);}
      }}/>} 
  </View>;
}
export function Poll({messageId,accent}: {messageId:string;accent?:string}) {
  const {client,setError}=useApp();
  const r=useQuery(api.polls.view,{messageId});
  if(!('data' in r)||!r.data) return null;
  const poll=r.data;
  return <PollDisplay question={poll.question} accentColor={accent}
    options={poll.options.map((o:any)=>({id:o.key,label:o.label,count:o.count,mine:poll.vote?.optionKey===o.key,pending:poll.vote?.optionKey===o.key&&!!poll.vote?.pending}))}
    onVote={async i=>{
      const w=await client.mutate(api.polls.vote,{messageId,optionKey:poll.options[i].key});
      if(w.state==='failed')setError(w.why.message);
    }}/>;
}
