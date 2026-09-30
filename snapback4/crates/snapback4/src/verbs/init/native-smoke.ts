// @ref LLP 3000.030#13 — unattended starter authentication uses the normal guest API.
import { useEffect, useRef } from "react";
import { useAuth } from "snapback4/react";
import { smokeSegment } from "snapback4-expo/witness";

export function useNativeSmokeGuest() {
  const auth = useAuth(), attempted = useRef(false);
  useEffect(() => {
    if (smokeSegment() !== "prime" || auth.state !== "signed-out" || attempted.current) return;
    attempted.current = true;
    void auth.guest();
  }, [auth]);
}
