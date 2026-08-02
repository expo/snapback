import React, {useState} from 'react';
import {useConnectionState, useQuery, useZero} from '@rocicorp/zero/react';
import {mutators} from '../zero/mutators.mjs';
import {queries} from '../zero/queries.mjs';

export function ZeroFieldNotebook() {
  const zero = useZero();
  const runMutation = zero.mutate as any;
  const connection = useConnectionState();
  const [data, result] = useQuery(queries.notebook.assigned());
  const records = data as unknown as Array<{id:string;title:string}>;
  const [draft, setDraft] = useState('');
  const writable = connection.name === 'connected';
  return <main data-testid="fn-zero-notebook">
    <output data-testid="fn-connection">{connection.name}</output>
    <output data-testid="fn-freshness">{result.type}</output>
    <textarea data-testid="fn-draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button data-testid="fn-save" disabled={!writable} onClick={() => void runMutation((mutators.notebook.create as unknown as (args:Record<string,unknown>)=>any)({
      id: crypto.randomUUID(), assignmentID: 'north', title: 'Draft', body: draft,
    }))}>Save</button>
    <ol>{records.map((record) => <li key={record.id} data-testid="fn-record">{record.title}</li>)}</ol>
  </main>;
}
