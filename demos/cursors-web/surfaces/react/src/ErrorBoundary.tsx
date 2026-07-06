// Cursor presence — React control-arm error boundary (ENG-22543, Diary 0011 P3).
//
// The red-team recorded an error-DX asymmetry: on a render-expression runtime
// error the Contract arm keeps its last-good pixels while the React arm blanked
// — the root unmounted because nothing caught the throw (Diary 0011, the "Pixels"
// row: Contract "keeps last-good UI" vs React "blank page — root unmounts (no
// error boundary in the arm)"). This closes that blank-page gap so future
// error-DX comparisons stay symmetric: a render throw shows a non-blank error
// panel with the message instead of an empty document.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const panelStyle: Record<string, string | number> = {
  position: 'fixed',
  inset: '0',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '32px',
  background: '#0b0d15',
  color: '#e6e9f2',
  font: '14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console signal the red-team relied on; the fallback keeps pixels.
    console.error('[cursors-web react] render error caught by boundary', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div data-testid="react-error-boundary" role="alert" style={panelStyle}>
          <strong style={{ fontSize: 16 }}>Cursor presence — render error</strong>
          <span data-testid="react-error-message">{error.message}</span>
          <span style={{ color: '#8b93a7' }}>
            The React surface caught a render error and kept the page rendered instead of blanking
            (ENG-22543, parity with the Contract arm). Reload to recover live presence.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}
