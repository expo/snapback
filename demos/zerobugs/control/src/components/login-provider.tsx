import {useMemo} from 'react';
import {useSession} from '../auth/session.tsx';
import {loginContext} from '../hooks/use-login.tsx';

export type LoginState = {
  decoded: {
    sub: string;
    name: string;
    role: 'crew' | 'user';
    login: string;
  };
};

export function LoginProvider({children}: {children: React.ReactNode}) {
  const session = useSession();
  const current = session.snapshot.current;
  const loginState = useMemo<LoginState | undefined>(() => current ? ({
    decoded: {
      sub: current.sourceUserID,
      name: current.login,
      role: current.role,
      login: current.login,
    },
  }) : undefined, [current]);

  return (
    <loginContext.Provider value={{
      logout: () => session.logout(),
      login: (redirect?: string) => session.login(redirect),
      loginState,
    }}>
      {children}
    </loginContext.Provider>
  );
}
