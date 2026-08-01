// Sessions-mode boot for the A2 sweep app: email-code sign-in, then the
// prepared React provider over an external-bearer session client.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createExternalSessionClient } from '@expo/snapback-client';
import { SnapbackProvider, createSnapbackReactProvider } from '@expo/snapback-react';
import { snapbackBasePath } from 'virtual:snapback/dev';
import { App } from './App';
import functions from '../snapback/generated/functions.manifest.json';
import capabilityManifest from '../snapback/generated/capability.manifest.json';
import schema from '../snapback/generated/schema.manifest.json';
import './styles.css';

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

type Session = {
  provider: ReturnType<typeof createSnapbackReactProvider>;
  displayName: string;
};

async function establish(bearerToken: string, displayName: string): Promise<Session> {
  const client = createExternalSessionClient(snapbackBasePath, { bearerToken });
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
  });
  return { provider: createSnapbackReactProvider(binding), displayName };
}

function SignIn({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${snapbackBasePath}/auth/request-code`, {
        method: 'POST',
        headers: protocolHeaders,
        body: JSON.stringify({ email }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.diagnostic?.code ?? 'request failed');
      setChallengeId(body.challengeId);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const exchange = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${snapbackBasePath}/auth/exchange`, {
        method: 'POST',
        headers: protocolHeaders,
        body: JSON.stringify({ challengeId, code }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.diagnostic?.code ?? 'exchange failed');
      const name = email.split('@')[0] ?? 'me';
      const displayName = name.slice(0, 1).toUpperCase() + name.slice(1);
      onSession(await establish(body.token, displayName));
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-frame" data-testid="sign-in">
      <main style={{ margin: 'auto', maxWidth: '26rem', padding: '2rem' }}>
        <h1>Sign in</h1>
        <p className="eyebrow">Sessions-mode email code (local dev provider)</p>
        {challengeId === null ? (
          <label className="composer">
            Email
            <input
              data-testid="sign-in-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void requestCode(); }}
              placeholder="alice@sweep-a2.test"
            />
          </label>
        ) : (
          <>
            <p>
              Enter the code for this challenge. In local dev the code is in the
              admin-gated mailbox: <code>GET /_snapback/api/auth/mailbox?challengeId=…</code>
              (admin token + impersonation capability required — never exposed to this page).
            </p>
            <label className="composer">
              Code
              <input
                data-testid="sign-in-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void exchange(); }}
                placeholder="123456"
              />
            </label>
          </>
        )}
        <div style={{ marginTop: '1rem' }}>
          {challengeId === null ? (
            <button className="primary" data-testid="sign-in-request" disabled={busy} onClick={() => void requestCode()}>
              Request code
            </button>
          ) : (
            <button className="primary" data-testid="sign-in-exchange" disabled={busy} onClick={() => void exchange()}>
              Sign in
            </button>
          )}
        </div>
        {error !== null && <p role="alert">{error}</p>}
      </main>
    </div>
  );
}

function Boot() {
  const [session, setSession] = useState<Session | null>(null);
  if (session === null) return <SignIn onSession={setSession} />;
  return (
    <SnapbackProvider provider={session.provider}>
      <App displayName={session.displayName} />
    </SnapbackProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
