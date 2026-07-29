import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { loadRuntime } from './provider';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="boot">Connecting to the isolated Snapback Chat target…</div>);

loadRuntime()
  .then(({ personas }) => {
    root.render(
      <StrictMode>
        <App personas={personas} />
      </StrictMode>,
    );
  })
  .catch((error) => {
    root.render(<pre data-testid="boot-error">{String(error?.stack ?? error)}</pre>);
  });
