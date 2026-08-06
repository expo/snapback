import { createContext, useContext, useMemo, useState } from 'react';
import type { Id } from '../snapback/generated/api.d.ts';

type DemoContextValue = Readonly<{
  activeUserId: Id<'users'>;
  setActiveUserId(id: Id<'users'>): void;
}>;

const DemoContext = createContext<DemoContextValue | null>(null);

export function G2DemoProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [activeUserId, setActiveUserId] = useState<Id<'users'>>('user_ada' as Id<'users'>);
  const value = useMemo(() => ({ activeUserId, setActiveUserId }), [activeUserId]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useG2Demo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error('useG2Demo must be used inside G2DemoProvider');
  return value;
}
