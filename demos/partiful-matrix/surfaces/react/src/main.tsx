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
  createRoot(root).render(<StrictMode><App provider={provider} initialPersona={personaFromSearch(location.search)} /></StrictMode>);
  return { backend: provider.backend, authoring: 'react', provider };
}

const ready = boot().catch((error) => {
  console.error('[partiful-matrix/react] boot failed', error);
  const root = document.getElementById('root');
  if (root) root.innerHTML = `<div class="boot-error"><b>This cell could not reach its backend.</b><span>${String(error)}</span></div>`;
  throw error;
});
(globalThis as { partifulMatrixReady?: unknown }).partifulMatrixReady = ready;
