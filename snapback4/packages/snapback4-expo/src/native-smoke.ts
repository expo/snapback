// @ref LLP 3000.000.000.001#10-wave-20-loop-repairs-dx5 — sign-in is confined to the owned native prime launch.
import { useEffect, useRef } from "react";
import { useAuth } from "snapback4/react";
import { smokeAccount, smokeSegment } from "./witness";

/** Ordinary launches do nothing. Password apps explicitly opt into the
 * driver's disposable account; guest apps keep ordinary guest sign-in. */
export function useNativeSmoke(password = false) {
  const auth = useAuth(), attempted = useRef(false);
  useEffect(() => {
    if (smokeSegment() !== "prime" || auth.state !== "signed-out" || attempted.current) return;
    const account = password ? smokeAccount() : null;
    if (password && !account) return;
    attempted.current = true;
    if (account) void auth.signup(account.email, account.password);
    else void auth.guest();
  }, [auth, password]);
}
