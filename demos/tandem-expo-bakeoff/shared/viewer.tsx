import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { DEMO_VIEWER } from './backend';

export type DemoViewer = { id: string; name: string; color: string };

export const DEMO_VIEWERS: readonly DemoViewer[] = [
  DEMO_VIEWER,
  { id: 'user_mina', name: 'Mina', color: '#EC6B82' },
  { id: 'user_ravi', name: 'Ravi', color: '#2D9C89' },
  { id: 'user_noor', name: 'Noor', color: '#E79B3B' },
] as const;

type ViewerContextValue = {
  viewer: DemoViewer;
  viewers: readonly DemoViewer[];
  setViewer(viewer: DemoViewer): void;
};

const ViewerContext = createContext<ViewerContextValue | null>(null);

export function DemoViewerProvider({ children }: PropsWithChildren) {
  const [viewer, setViewer] = useState<DemoViewer>(DEMO_VIEWER);
  const value = useMemo(() => ({ viewer, viewers: DEMO_VIEWERS, setViewer }), [viewer]);
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useDemoViewer() {
  const context = useContext(ViewerContext);
  if (!context) throw new Error('useDemoViewer must be used inside DemoViewerProvider');
  return context;
}
