import React, {useState} from 'react';
import {useSnapbackConnection, useSnapbackMutation, useSnapbackQuery} from '../../../../../packages/snapback-react/index.mjs';
import api from '../snapback/generated/api.mjs';

export function SnapbackFieldNotebook() {
  const connection=useSnapbackConnection();
  const query=useSnapbackQuery(api.assignedRecords,{assignmentId:'north'});
  const create=useSnapbackMutation(api.createRecord);
  const [draft,setDraft]=useState('');
  const records=query.status==='ready'||query.status==='refreshing'?query.data:[];
  return <main data-testid="fn-snapback-notebook">
    <output data-testid="fn-connection">{connection.status}</output>
    <output data-testid="fn-freshness">{query.status}</output>
    <textarea data-testid="fn-draft" value={draft} onChange={event=>setDraft(event.target.value)} />
    <button data-testid="fn-save" onClick={()=>void create({assignmentId:'north',title:'Draft',body:draft})}>Save</button>
    <ol>{records.map(record=><li key={record._id} data-testid="fn-record">{record.title}</li>)}</ol>
  </main>;
}
