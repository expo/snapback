import React, { useState } from 'react';

export const FIXTURE_EMAIL = 'fixture@example.com';
export const FIXTURE_PASSWORD = 'fixture-password-1234';

export function createAuthPanel({ useAuth, useCurrentPrincipal }) {
  return function AuthPanel({ onSnapshot = () => {} }) {
    const auth = useAuth();
    const principal = useCurrentPrincipal();
    const [recoveryCodes, setRecoveryCodes] = useState(null);
    const [error, setError] = useState(null);

    onSnapshot({ auth, principal, recoveryCodes, error });

    const run = async (operation) => {
      setError(null);
      setRecoveryCodes(null);
      try {
        if (operation === 'signup') {
          const result = await auth.signUpWithPassword({
            email: FIXTURE_EMAIL,
            password: FIXTURE_PASSWORD,
          });
          setRecoveryCodes(result.recoveryCodes);
        } else if (operation === 'signin') {
          await auth.signInWithPassword({
            email: FIXTURE_EMAIL,
            password: FIXTURE_PASSWORD,
          });
        } else {
          await auth.signOut();
        }
      } catch (cause) {
        setError(cause);
        throw cause;
      }
    };

    return React.createElement(
      'main',
      null,
      React.createElement('p', { 'data-fixture': 'principal-status' }, principal.status),
      principal.status === 'authenticated'
        ? React.createElement('p', { 'data-fixture': 'principal-id' }, principal.userId)
        : null,
      recoveryCodes === null
        ? null
        : React.createElement(
          'output',
          { 'data-fixture': 'recovery-codes' },
          recoveryCodes.join('\n'),
        ),
      React.createElement(
        'button',
        { 'data-action': 'signup', onClick: () => run('signup') },
        'Sign up',
      ),
      React.createElement(
        'button',
        { 'data-action': 'signin', onClick: () => run('signin') },
        'Sign in',
      ),
      React.createElement(
        'button',
        { 'data-action': 'signout', onClick: () => run('signout') },
        'Sign out',
      ),
    );
  };
}
