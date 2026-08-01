// Sessions-mode boot for the A4 event app: email-code sign-in, deep-link
// invite redemption (?invite=CODE — the invitation entry the acceptance
// suite attributes), then the prepared provider wraps the neutral shell.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackClient } from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  type SnapbackReactProvider,
} from '@expo/snapback-react';
import { snapbackBasePath } from 'virtual:snapback/dev';
import { App } from './App';
import api from '../snapback/generated/api.mjs';
import functions from '../snapback/generated/functions.manifest.json';
import capabilityManifest from '../snapback/generated/capability.manifest.json';
import schema from '../snapback/generated/schema.manifest.json';

const headers = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

function Boot() {
  const deepLinkInvite = new URLSearchParams(window.location.search).get('invite') ?? '';
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [provider, setProvider] = useState<SnapbackReactProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    setError(null);
    const requested = await fetch(`${snapbackBasePath}/auth/request-code`, {
      method: 'POST', headers, body: JSON.stringify({ email }),
    }).then((r) => r.json());
    if (typeof requested.challengeId !== 'string') { setError('request failed'); return; }
    setChallengeId(requested.challengeId);
  };

  const exchange = async () => {
    setError(null);
    const credential = await fetch(`${snapbackBasePath}/auth/exchange`, {
      method: 'POST', headers, body: JSON.stringify({ challengeId, code }),
    }).then((r) => r.json());
    if (typeof credential.token !== 'string') { setError('exchange failed'); return; }
    const client = new SnapbackClient(snapbackBasePath, { bearerToken: credential.token });
    const binding = await client.prepareReactBinding({
      generatedManifest: { schema, functions, capabilityManifest },
    });
    const prepared = createSnapbackReactProvider(binding);
    if (deepLinkInvite.trim()) {
      try {
        await invokeSnapbackMutation(prepared, api.redeemInvite, {
          code: deepLinkInvite.trim(),
          name: name.trim() || email,
          enteredVia: 'deep-link',
        });
      } catch {
        // an already-consumed invite is fine for a returning guest
      }
    }
    setProvider(prepared);
  };

  if (provider) {
    return (
      <SnapbackProvider provider={provider}><App /></SnapbackProvider>
    );
  }
  return (
    <main className="signin" data-testid="signin">
      <h1>Lantern Supper Club</h1>
      {deepLinkInvite && <p data-testid="signin-invite-banner">You are invited — code {deepLinkInvite}</p>}
      {challengeId === null ? (
        <label>Email
          <input data-testid="signin-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button data-testid="signin-request" onClick={() => void requestCode()}>Send code</button>
        </label>
      ) : (
        <label>Code
          <input data-testid="signin-code" value={code} onChange={(e) => setCode(e.target.value)} />
          <input data-testid="signin-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <button data-testid="signin-exchange" onClick={() => void exchange()}>Sign in</button>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Boot /></StrictMode>,
);
