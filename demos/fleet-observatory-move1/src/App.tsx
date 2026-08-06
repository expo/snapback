import { useState } from 'react';

import { skip, useSnapbackQuery } from '@expo/snapback-react';

import api from '../snapback/generated/api';
import type { Id } from '../snapback/generated/api';

type FleetViewId = Id<'fleetViews'>;
export type FleetAuthClient = {
  authRequestCode(email: string): Promise<{ challengeId: string }>;
  authExchange(input: { challengeId: string; code: string }): Promise<unknown>;
};

export function App({ client }: { client: FleetAuthClient }) {
  const [email, setEmail] = useState('owner@fleet-observatory.test');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [viewId, setViewId] = useState(() => localStorage.getItem('fleet-view-id') ?? '');
  const [status, setStatus] = useState('Sign in, then open the seeded Fleet view.');

  // @ref LLP 0157#move-1-workload-exit-llp-0155-normative-transcription — the
  // required screen has one generated read owner: the mixed v2 tuple itself.
  // Vehicle and owner fields already came from its relational node; this
  // component does not reconstruct either collection join.
  const fleet = useSnapbackQuery(
    api.fleetObservatory,
    viewId ? { viewId: viewId as FleetViewId } : skip,
  );
  const envelope = fleet.data?.[0];
  const visible = envelope?.kind === 'visible' ? envelope : null;
  const events = visible?.nodes[0] ?? [];
  const rollups = visible?.nodes[1].children ?? [];

  const openView = () => {
    if (!viewId) return;
    localStorage.setItem('fleet-view-id', viewId);
    setStatus('The generated mixed Fleet tuple is active.');
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LLP 0157 · Move-1 successor</p>
          <h1>Fleet Observatory</h1>
        </div>
        <div className="facts">
          <span>{fleet.status}</span>
          <span>{fleet.freshness}</span>
          <span>{fleet.retention?.retainable === false ? 'volatile' : 'unclassified'}</span>
        </div>
      </header>

      <section className="controls" aria-label="Fleet session and view">
        <label>Email <input value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button onClick={() => void client.authRequestCode(email).then((request) => {
          setChallengeId(request.challengeId);
          setStatus('Code requested. Read it from the trusted local mailbox.');
        })}>Request code</button>
        <label>Code <input value={code} onChange={(event) => setCode(event.target.value)} /></label>
        <button disabled={!challengeId || !code} onClick={() => void client.authExchange({
          challengeId,
          code,
        }).then(() => setStatus('Authenticated. Enter the seeded Fleet view id.'))}>Exchange</button>
        <label>View id <input value={viewId} onChange={(event) => setViewId(event.target.value)} /></label>
        <button className="primary" disabled={!viewId} onClick={openView}>Open Fleet view</button>
      </section>

      <p className="status">{status}</p>
      {fleet.error ? <p className="error">{fleet.error.message}</p> : null}

      <section className="grid">
        <article>
          <p className="eyebrow">Relational node · already joined</p>
          <h2>Latest events <span>{events.length}/100</span></h2>
          <ul>{events.map((event) => (
            <li key={event.eventKey}>
              <strong>{event.deviceName}</strong>
              <span>{event.message}</span>
              <small>{event.ownerName} · {event.region} · {event.deviceStatus}</small>
            </li>
          ))}</ul>
        </article>

        <article>
          <p className="eyebrow">Bounded-child node · same snapshot</p>
          <h2>Vehicle rollups <span>{rollups.length}/100</span></h2>
          <ul>{rollups.map((rollup) => (
            <li key={rollup.id}>
              <strong>{rollup.deviceKey}</strong>
              <span>{rollup.currentMessage}</span>
              <small>{rollup.ownerName} · {rollup.activeMatch ? 'active match' : 'watching'}</small>
            </li>
          ))}</ul>
        </article>
      </section>
    </main>
  );
}
