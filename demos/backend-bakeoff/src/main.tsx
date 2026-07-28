import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createBackend } from './backends';
import type { BackendKind } from './types';
import './styles.css';

const requested = new URLSearchParams(location.search).get('backend');
const kind: BackendKind =
  requested === 'convex' || requested === 'supabase' || requested === 'snapback'
    ? requested
    : 'snapback';

async function boot() {
  const backend = await createBackend(kind);
  await backend.setup();
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  createRoot(root).render(
    <StrictMode>
      <App backend={backend} kind={kind} />
    </StrictMode>,
  );
  return backend;
}

void boot().catch((cause) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<main class="boot boot--error"><strong>Signal Desk could not start.</strong><p>${String(cause?.message ?? cause)}</p></main>`;
  }
  console.error(cause);
});
