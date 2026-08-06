import {useLogin} from './use-login.tsx';

export function useCanEdit(ownerUserID: string | undefined): boolean {
  const login = useLogin();
  const currentUserID = login.loginState?.decoded.sub;
  return (
    login.loginState?.decoded.role === 'crew' ||
    ownerUserID === currentUserID
  );
}
