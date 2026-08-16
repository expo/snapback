import React from 'react';
import {
  SnapbackExpoProvider,
  useSnapbackAuth,
  useSnapbackCurrentPrincipal,
} from '@expo/snapback-expo';

import { app } from './snapback/generated/app.mjs';
import { createAuthPanel } from '../../shared/auth-panel.mjs';

const AuthPanel = createAuthPanel({
  useAuth: useSnapbackAuth,
  useCurrentPrincipal: useSnapbackCurrentPrincipal,
});

export function Application({ environment, onSnapshot }) {
  return React.createElement(
    SnapbackExpoProvider,
    {
      app,
      environment,
      fallback: (state) => React.createElement(
        'pre',
        { 'data-fixture': 'boot' },
        JSON.stringify(state),
      ),
    },
    React.createElement(AuthPanel, { onSnapshot }),
  );
}

export { app };
