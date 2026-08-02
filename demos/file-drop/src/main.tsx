import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackProvider } from '@expo/snapback-react';
import { App } from './App';
import { provider } from './snapback';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SnapbackProvider provider={provider}>
      <App />
    </SnapbackProvider>
  </StrictMode>,
);

