import { createContext, useContext, useMemo, useState } from 'react';
import type { Id } from '../snapback/generated/api.d.ts';

type TestPersonaContextValue = Readonly<{
  activeUserId: Id<'users'>;
  setActiveUserId(id: Id<'users'>): void;
}>;

const TestPersonaContext = createContext<TestPersonaContextValue | null>(null);

// @ref LLP 0196#program — T0's seeded identity switcher
// is visibly test-only; production identity must come from adopted authority.
export function TestPersonaProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [activeUserId, setActiveUserId] = useState<Id<'users'>>('user_ada' as Id<'users'>);
  const value = useMemo(() => ({ activeUserId, setActiveUserId }), [activeUserId]);
  return <TestPersonaContext.Provider value={value}>{children}</TestPersonaContext.Provider>;
}

export function useTestPersona() {
  const value = useContext(TestPersonaContext);
  if (!value) throw new Error('useTestPersona must be used inside TestPersonaProvider');
  return value;
}
