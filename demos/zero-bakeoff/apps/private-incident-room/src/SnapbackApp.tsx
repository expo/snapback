import React from 'react';
import {useSnapbackConnection, useSnapbackMutation, useSnapbackQuery} from '../../../../../packages/snapback-react/index.mjs';
import api from '../snapback/generated/api.mjs';
import type {Id} from '../snapback/generated/api.d.ts';

export function SnapbackIncidentRoom({incidentID}: {incidentID: Id<'incidents'>}) {
  const room=useSnapbackQuery(api.incidentMessages,{incidentId:incidentID});
  const post=useSnapbackMutation(api.postMessage);
  const connection=useSnapbackConnection();
  const messages=room.status==='ready'||room.status==='refreshing'?room.data:[];
  return <main data-testid="ir-snapback-room">
    <output data-testid="ir-connection">{connection.status}</output>
    <output data-testid="ir-freshness">{room.status}</output>
    <ol>{messages.map(message=><li key={message._id} data-testid="ir-message">{message.body}</li>)}</ol>
    <button data-testid="ir-post" onClick={()=>void post({incidentId:incidentID,body:'Status update'})}>Post</button>
  </main>;
}
