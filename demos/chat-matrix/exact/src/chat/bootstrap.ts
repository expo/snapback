import { ChatContractProvider, type Backend } from './provider.js';
import {
  configureChatLinks,
  resetChatLinks,
  type ChatLinks,
} from './data/runtime-links.js';

declare const __CHAT_BACKEND__: Backend;
declare const __CHAT_GATEWAY_ORIGIN__: string;

/** Configure one backend-neutral Contract provider before the router mounts. */
export function configureChatData(): () => void {
  const provider = new ChatContractProvider(__CHAT_BACKEND__, __CHAT_GATEWAY_ORIGIN__);
  configureChatLinks(provider.links() as ChatLinks);
  return () => {
    provider.dispose();
    resetChatLinks();
  };
}
