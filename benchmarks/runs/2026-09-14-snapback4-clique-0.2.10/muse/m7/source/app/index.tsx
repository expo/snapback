import React from "react";
import Chats from "./chats";
import { AuthScreen, useAppClient } from "../lib/client";

/** Home is the conversation list (standard messenger IA); the social feed
 * lives at /feed and its tabs stay mounted above every route. */
export default function Index() {
  const { client } = useAppClient();
  if (!client) return <AuthScreen />;
  return <Chats />;
}
