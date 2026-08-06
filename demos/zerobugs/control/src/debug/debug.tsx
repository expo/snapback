import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {SnapbackProvider} from '@expo/snapback-react';
import 'react-toastify/dist/ReactToastify.css';
import '../index.css';
import {SessionProvider} from '../auth/session.tsx';
import {LoginProvider} from '../components/login-provider.tsx';
import {sessionController, snapbackProvider} from '../data/snapback.ts';
import {DebugApp} from './debug-app.tsx';

const mount = document.getElementById('debug-root');
if (!mount) throw new Error('missing #debug-root mount point');
createRoot(mount).render(
  <StrictMode>
    <SnapbackProvider provider={snapbackProvider}>
      <SessionProvider controller={sessionController}>
        <LoginProvider><DebugApp /></LoginProvider>
      </SessionProvider>
    </SnapbackProvider>
  </StrictMode>,
);
