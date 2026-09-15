import React from "react";
import { Slot } from "expo-router";
import { Session } from "../src/session";
export default function Layout() {
  return (
    <Session>
      <Slot />
    </Session>
  );
}
