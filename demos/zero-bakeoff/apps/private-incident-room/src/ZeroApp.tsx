import React from 'react';
import {useConnectionState, useQuery, useZero} from '@rocicorp/zero/react';
import {mutators} from '../zero/mutators.mjs';
import {queries} from '../zero/queries.mjs';

export function ZeroIncidentRoom({incidentID}: {incidentID: string}) {
  const zero = useZero();
  const runMutation = zero.mutate as any;
  const connection = useConnectionState();
  const [data, result] = useQuery(queries.incidents.room({incidentID}));
  const messages = data as unknown as Array<{id:string;body:string;sequence:number}>;
  return <main data-testid="ir-zero-room">
    <output data-testid="ir-connection">{connection.name}</output>
    <output data-testid="ir-completeness">{result.type}</output>
    <ol>{messages.map((message) => <li key={message.id} data-testid="ir-message">{message.body}</li>)}</ol>
    <button data-testid="ir-post" onClick={() => void runMutation((mutators.incidents.postMessage as unknown as (args:Record<string,unknown>)=>any)({
      id: crypto.randomUUID(), incidentID, sequence: (messages.at(-1)?.sequence ?? 0) + 1, body: 'Status update',
    }))}>Post</button>
  </main>;
}
