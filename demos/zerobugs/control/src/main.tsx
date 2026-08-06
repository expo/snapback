import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {SnapbackProvider} from '@expo/snapback-react';
import 'react-toastify/dist/ReactToastify.css';

import {SessionProvider} from './auth/session.tsx';
import {LoginProvider} from './components/login-provider.tsx';
import {sessionController, snapbackProvider} from './data/snapback.ts';
import './index.css';
import {Root} from './root.tsx';

const mount = document.getElementById('root');
if (!mount) throw new Error('missing #root mount point');

createRoot(mount).render(
  <StrictMode>
    <SnapbackProvider provider={snapbackProvider}>
      <SessionProvider controller={sessionController}>
        <LoginProvider>
          <Root />
        </LoginProvider>
      </SessionProvider>
    </SnapbackProvider>
  </StrictMode>,
);
