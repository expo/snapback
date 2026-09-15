import React from "react";
import { Shell, Button } from "../src/common";
import { useApp } from "../src/session";
export default function Settings() {
  const { signOut } = useApp();
  return (
    <Shell>
      <Button testID="sm-settings-logout" onPress={signOut}>
        Log out
      </Button>
    </Shell>
  );
}
