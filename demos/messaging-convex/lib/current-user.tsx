import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { sessionStorage } from "./session-storage";
import type { Id } from "@/convex/_generated/dataModel";

const STORAGE_KEY = "messaging-convex.currentUserId";

type CurrentUserContextValue = {
  userId: Id<"users"> | null;
  loading: boolean;
  setUserId: (id: Id<"users"> | null) => void;
};

const CurrentUserContext = createContext<CurrentUserContextValue | null>(
  null
);

export function CurrentUserProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userId, setUserIdState] = useState<Id<"users"> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) setUserIdState(stored as Id<"users">);
      setLoading(false);
    });
  }, []);

  const setUserId = (id: Id<"users"> | null) => {
    setUserIdState(id);
    if (id) {
      sessionStorage.setItem(STORAGE_KEY, id);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  };

  const value = useMemo(
    () => ({ userId, loading, setUserId }),
    [userId, loading]
  );

  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    throw new Error("useCurrentUser must be used within CurrentUserProvider");
  }
  return ctx;
}
