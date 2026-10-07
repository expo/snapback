import { useCallback, useEffect, useRef, useState } from "react";
import type { FlatList, ViewToken } from "react-native";
import { matchRead, type ResultOf } from "snapback4/contract";
import { usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";

type Message = ResultOf<typeof api.history>[number];
type Target = { id: string; conversation: string; ordinal: number };
const EMPTY: Message[] = [];
export const JUMP_TIMEOUT_MS = 4000, HIGHLIGHT_MS = 1800;

// @ref LLP 3000.028#8 — only IDs/positions are UI state; live pages own bodies.
export function useJumpToMessage(conversation: string) {
  const [through, setThrough] = useState<number | null>(null);
  const page = usePage(api.history, { conversation, through });
  const rows = matchRead(page.read, { present: data => data, denied: () => EMPTY, partial: data => data, otherwise: () => EMPTY });
  const list = useRef<FlatList<Message>>(null);
  const [request, setRequest] = useState<{ id: string; until: number }>();
  const [highlighted, setHighlighted] = useState<string>();
  const [problem, setProblem] = useState("");
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
    const next = new Set(viewableItems.filter(item => item.isViewable).map(item => item.item.id));
    setViewed(current => current.size === next.size && [...current].every(id => next.has(id)) ? current : next);
  }, []);
  const onJump = (target: Target) => {
    if (target.conversation !== conversation) { setProblem("Quoted message belongs to another conversation"); return; }
    setProblem(""); setHighlighted(undefined);
    if (!rows.some(row => row.id === target.id)) { setViewed(new Set()); setThrough(target.ordinal); }
    setRequest({ id: target.id, until: performance.now() + JUMP_TIMEOUT_MS });
  };
  useEffect(() => {
    if (!request) return;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const fail = (text: string) => { setProblem(text); setRequest(undefined); };
      if (performance.now() >= request.until) { fail("Could not reach quoted message. Tap the quote to retry."); return; }
      matchRead(page.read, {
        loading: () => {},
        denied: () => fail("Quoted message hidden"),
        absent: read => { if (!read.revalidating) fail("Quoted message unavailable"); },
        partial: () => fail("Quoted message not yet known"),
        present: (data, read) => {
          if (read.revalidating) return;
          const index = data.findIndex(row => row.id === request.id && !row.pending);
          if (index < 0) { fail("Quoted message not in this history window"); return; }
          if (viewed.has(request.id)) { setHighlighted(request.id); setRequest(undefined); return; }
          list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
        },
      });
      timer = setTimeout(attempt, 100);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [request, page.read, viewed]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(undefined), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);
  // Variable-height rows: first approach the unmeasured index, then the loop
  // retries against measured cells. Success requires actual full visibility.
  const onScrollToIndexFailed = ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    if (request) list.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false });
  };
  const latest = () => { setRequest(undefined); setHighlighted(undefined); setProblem(""); setThrough(null); };
  return { page, rows, through, list, onJump, onViewableItemsChanged, onScrollToIndexFailed,
    viewed, highlighted, problem, jumping: !!request, latest };
}
