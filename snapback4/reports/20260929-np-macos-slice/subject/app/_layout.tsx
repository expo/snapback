import { NPProbe } from "../src/NPProbe";
import React from "react";
import { Slot } from "expo-router";
import { AppProvider } from "snapback4/react";
import { NavigationProvider } from "../src/navigation";
import { app } from "../src/client";
export default function Layout() {
  return (
    <>
    <NPProbe />
    <AppProvider app={app}>
      <NavigationProvider>
        <Slot />
      </NavigationProvider>
    </AppProvider>
    </>
  );
}
// stage0 warm marker 1790654592
// stage0 repack marker 1790654730
