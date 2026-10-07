import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent, type View, type ViewToken } from "react-native";
import { matchRead, type ResultOf } from "snapback4/contract";
import { usePage } from "snapback4/react";
import { api } from "../snapback/generated/api";

type Message = ResultOf<typeof api.history>[number];
type Target = { id: string; conversation: string; ordinal: number };
type Jump = { id: string; until: number; settling?: boolean; highlightUntil?: number; visible?: boolean; approached?: boolean };
type Rect = { y: number; height: number };
const measure = (node: View) => new Promise<Rect>(resolve => node.measureInWindow((_x, y, _width, height) => resolve({ y, height })));
const fits = (box: Rect, viewport: Rect) => box.height <= viewport.height
  ? box.y >= viewport.y - 1 && box.y + box.height <= viewport.y + viewport.height + 1
  : box.y <= viewport.y && box.y + box.height >= viewport.y + viewport.height;
const EMPTY: Message[] = [];
export const JUMP_TIMEOUT_MS = 4000, SETTLE_MS = 4000, HIGHLIGHT_MS = 1800;

// @ref LLP 3000.028#8 — only IDs/positions are UI state; live pages own bodies.
export function useJumpToMessage(conversation: string) {
  const [through, setThrough] = useState<number | null>(null);
  const page = usePage(api.history, { conversation, through });
  const rows = matchRead(page.read, { present: data => data, denied: () => EMPTY, partial: data => data, otherwise: () => EMPTY });
  const list = useRef<FlatList<Message> | null>(null), viewport = useRef<View>(null);
  const bubbles = useRef(new Map<string, View>()), bodies = useRef(new Map<string, View>());
  const offset = useRef(0), layout = useRef(0), check = useRef<() => void>(() => {});
  const active = useRef<Jump | undefined>(undefined);
  const [request, setRequest] = useState<Jump>();
  const [completed, setCompleted] = useState<string>(), [highlighted, setHighlighted] = useState<string>();
  const [jumping, setJumping] = useState(false), [problem, setProblem] = useState("");
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const bindList = useCallback((node: FlatList<Message> | null) => { list.current = node; offset.current = 0; }, []);
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
    const next = new Set(viewableItems.filter(item => item.isViewable).map(item => item.item.id));
    setViewed(current => current.size === next.size && [...current].every(id => next.has(id)) ? current : next);
  }, []);
  const cancel = useCallback(() => {
    active.current = undefined; setRequest(undefined); setJumping(false); setHighlighted(undefined);
  }, []);
  const onJump = (target: Target) => {
    cancel(); setCompleted(undefined);
    if (target.conversation !== conversation) { setProblem("Quoted message belongs to another conversation"); return; }
    setProblem(""); setJumping(true);
    if (!rows.some(row => row.id === target.id)) { setViewed(new Set()); setThrough(target.ordinal); }
    const next = { id: target.id, until: performance.now() + JUMP_TIMEOUT_MS };
    active.current = next; setRequest(next);
  };
  const onLayout = useCallback(() => {
    layout.current++;
    if (active.current) { active.current.visible = false; setHighlighted(undefined); check.current(); }
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y; check.current();
  }, []);
  useEffect(() => {
    if (!request) return;
    let disposed = false, measuring = false;
    const current = () => !disposed && active.current === request;
    const fail = (text: string) => { cancel(); setCompleted(undefined); setProblem(text); };
    const attempt = () => {
      if (!current()) return;
      const now = performance.now();
      if (now >= request.until) {
        if (request.settling && request.visible) cancel();
        else fail(request.settling ? "Could not keep quoted message in view. Tap the quote to retry." : "Could not reach quoted message. Tap the quote to retry.");
        return;
      }
      if (request.highlightUntil && now >= request.highlightUntil) setHighlighted(undefined);
      const wait = () => { request.visible = false; setHighlighted(undefined); };
      matchRead(page.read, {
        loading: wait,
        denied: () => fail("Quoted message hidden"),
        absent: read => { if (read.revalidating) wait(); else fail("Quoted message unavailable"); },
        partial: () => fail("Quoted message not yet known"),
        present: (data, read) => {
          if (read.revalidating) { wait(); return; }
          const index = data.findIndex(row => row.id === request.id && !row.pending);
          if (index < 0) { fail("Quoted message not in this history window"); return; }
          const bubble = bubbles.current.get(request.id), body = bodies.current.get(request.id), frame = viewport.current;
          if (!bubble || !body || !frame) { list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 }); return; }
          if (measuring) return;
          measuring = true;
          const revision = layout.current;
          void Promise.all([measure(bubble), measure(body), measure(frame)]).then(([row, text, view]) => {
            if (!current() || revision !== layout.current || bubbles.current.get(request.id) !== bubble || performance.now() >= request.until) return;
            if (view.height <= 0 || row.height <= 0 || text.height <= 0) return;
            // A tall nested quote must not leave the original's own text below the viewport.
            const target = row.height <= view.height ? row : text;
            request.visible = fits(target, view);
            if (request.visible) {
              if (!request.settling) {
                request.settling = true; request.until = performance.now() + SETTLE_MS;
                request.highlightUntil = performance.now() + HIGHLIGHT_MS;
                setCompleted(request.id); setJumping(false);
              }
              setHighlighted(performance.now() < request.highlightUntil! ? request.id : undefined);
            } else {
              setHighlighted(undefined);
              if (!request.approached && !request.settling) {
                request.approached = true; list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
              } else {
                const delta = target.y + target.height / 2 - view.y - view.height / 2;
                list.current?.scrollToOffset({ offset: Math.max(0, offset.current + delta), animated: false });
              }
            }
          }).finally(() => { measuring = false; });
        },
      });
    };
    check.current = attempt;
    const timer = setInterval(attempt, 100); attempt();
    return () => { disposed = true; clearInterval(timer); check.current = () => {}; };
  }, [request, page.read, cancel]);
  // Native drag/touch and web wheel, scrollbar/pointer and scrolling keys all
  // relinquish ownership synchronously, including any in-flight measurement.
  useEffect(() => {
    if (!request || Platform.OS !== "web" || typeof document === "undefined") return;
    // Browsers can scroll the last focused list after its quote loses focus.
    // Capture body-targeted keys too, only while this jump owns scrolling.
    const keyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancel();
    };
    document.addEventListener("keydown", keyDown, true);
    return () => document.removeEventListener("keydown", keyDown, true);
  }, [request, cancel]);
  const webScrollHandlers = Platform.OS === "web" ? { onWheel: cancel, onPointerDown: cancel } : {};
  const onScrollToIndexFailed = ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    if (active.current) list.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false });
  };
  const latest = () => { cancel(); setCompleted(undefined); setProblem(""); setThrough(null); };
  return { page, rows, through, bindList, viewport, bubbles, bodies, onJump, onViewableItemsChanged, onScrollToIndexFailed,
    onLayout, onScroll, cancel, webScrollHandlers, viewed, completed, highlighted, problem, jumping, latest };
}
