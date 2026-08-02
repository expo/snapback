import React, {useEffect, useState} from 'react';
import type {Replicache} from 'replicache';

type RecordRow={id:string;title:string;body:string};

export function ReplicacheFieldNotebook({rep}: {rep: Replicache<any>}) {
  const [records,setRecords]=useState<RecordRow[]>([]),[draft,setDraft]=useState('');
  useEffect(()=>rep.subscribe(tx=>tx.scan({prefix:'record/'}).values().toArray() as Promise<RecordRow[]>,setRecords),[rep]);
  return <main data-testid="fn-replicache-notebook">
    <output data-testid="fn-connection">{rep.online?'online':'offline'}</output>
    <output data-testid="fn-freshness">{rep.online?'current-after-sync':'retained/stale'}</output>
    <textarea data-testid="fn-draft" value={draft} onChange={event=>setDraft(event.target.value)} />
    <button data-testid="fn-save" onClick={()=>void rep.mutate.create({id:crypto.randomUUID(),assignmentID:'north',title:'Draft',body:draft})}>Save</button>
    <ol>{records.map(record=><li key={record.id} data-testid="fn-record">{record.title}</li>)}</ol>
  </main>;
}
