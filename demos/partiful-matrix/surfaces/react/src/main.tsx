import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { personaFromSearch } from '../../../shared/model';
import { App } from './App';
import { createMatrixProvider } from './provider';
import './styles.css';

async function boot() {
  const provider = await createMatrixProvider();
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  const reactRoot = createRoot(root);
  reactRoot.render(<StrictMode><App provider={provider} initialPersona={personaFromSearch(location.search)} /></StrictMode>);

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pagehide', onPageHide);
    reactRoot.unmount();
    await provider.dispose?.();
  };
  const onPageHide = () => { void dispose(); };
  window.addEventListener('pagehide', onPageHide, { once: true });
  const hot = (import.meta as ImportMeta & { hot?: { dispose(callback: () => void): void } }).hot;
  if (hot) hot.dispose(() => { void dispose(); });

  return {
    backend: provider.backend,
    authoring: 'react',
    provider,
    dispose,
    transportEvidence: () => provider.transportEvidence?.() ?? [],
  };
}

const ready = boot().catch((error) => {
  console.error('[partiful-matrix/react] boot failed', error);
  const root = document.getElementById('root');
  if (root) root.innerHTML = `<div class="boot-error"><b>This cell could not reach its backend.</b><span>${String(error)}</span></div>`;
  throw error;
});
(globalThis as { partifulMatrixReady?: unknown }).partifulMatrixReady = ready;
