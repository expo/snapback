import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { loadRuntime } from './provider';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="boot">Connecting to the local Snapback target…</div>);

loadRuntime()
  .then(({ personas, primaryWorkspaceId }) => {
    root.render(
      <StrictMode>
        <App personas={personas} primaryWorkspaceId={primaryWorkspaceId} />
      </StrictMode>,
    );
  })
  .catch((error) => {
    root.render(<pre data-testid="boot-error">{String(error?.stack ?? error)}</pre>);
  });
