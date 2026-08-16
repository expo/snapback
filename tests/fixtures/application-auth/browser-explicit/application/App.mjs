import React from 'react';
import { createSnapbackAppClient } from '@expo/snapback-client';
import {
  SnapbackProvider,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
} from '@expo/snapback-react';

import { app } from './snapback/generated/app.mjs';
import { createAuthPanel } from '../../shared/auth-panel.mjs';

const AuthPanel = createAuthPanel({
  useAuth: useSnapbackAuth,
  useCurrentPrincipal: useSnapbackCurrentPrincipal,
});

export async function createApplication({ binding, platform, now, onSnapshot }) {
  const appClient = await createSnapbackAppClient({ app, binding, platform, now });
  return Object.freeze({
    app,
    appClient,
    element: React.createElement(
      SnapbackProvider,
      {
        appClient,
        fallback: (state) => React.createElement(
          'pre',
          { 'data-fixture': 'boot' },
          JSON.stringify(state),
        ),
      },
      React.createElement(AuthPanel, { onSnapshot }),
    ),
  });
}

export { app };
