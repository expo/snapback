// All Aboard — web gesture glue (LLP 0027 interaction model; LLP 0029 G1;
// gesture zones redesigned under ENG-23719).
//
// Contract has no swipe/pan primitive (the event vocabulary is press-family
// only), so the gesture-first interaction ships as WEB SURFACE GLUE over the
// DOM mirror. Gestures are REGION-scoped now that the home screen scrolls:
//
//   - the red station header is the station-navigation surface: horizontal
//     swipes there page to the adjacent station (finger-follow drag and a
//     page-turn settle on the whole screen);
//   - the departures board walks the selected train with horizontal swipes
//     (earlier trains sit to the left, later to the right, so swiping left
//     pulls the next/later train in and swiping right goes back to earlier);
//     vertical movement there is NATIVE scrolling — the glue must never
//     capture it (board-content declares touch-action: pan-y in main.ts);
//   - the sheet screens (stations / settings / trip) go back on swipe right;
//   - arrow keys mirror the zones for desktop: ←/→ earlier/later train,
//     ↑/↓ previous/next station (the corridor runs north→south).
//
// Dispatch is deliberately dumb: every recognized gesture CLICKS the same
// visible press affordance the .contract declares (header edge chevrons, the
// ‹ › train arrows, the flip pill, Back). Gestures, taps, keyboard, acceptance
// tests, and the native host therefore drive one action path, and the gesture
// layer holds zero app state. When Exact grows real gesture primitives (the
// motion RFCs; LLP 0029 G1), this file is deleted and swipe= attributes
// replace it.
//
// Visual feedback owns only inline transform/opacity/transition on nodes whose
// Contract props are static — the DOM mirror re-applies styles just for nodes
// whose props object changed, so glue-owned inline styles survive the 1s tick
// re-renders; they are cleared after every settle animation regardless.

type Cleanup = () => void;

const SLOP_PX = 12;
const H_COMMIT_PX = 64;
const H_COMMIT_VELOCITY = 0.5; // px/ms

export function installGestures(root: HTMLElement): Cleanup {
  const q = (id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  // Synthetic presses must sail past suppressNextClick(), which only exists to
  // kill the browser's own trailing click after a drag.
  let dispatching = false;
  const press = (id: string) => {
    dispatching = true;
    try {
      q(id)?.click();
    } finally {
      dispatching = false;
    }
  };
  const screenEl = () => q('station-screen');
  const boardEl = () => q('board-content');
  const onHome = () => !!q('station-screen');
  const onTrip = () => !!q('trip-screen');
  const onStations = () => !!q('stations-screen');
  const onSettings = () => !!q('settings-screen');

  let pointerId: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let dy = 0;
  // Which surface the drag started on decides what a horizontal swipe means.
  let region: 'header' | 'board' | 'sheet' | null = null;
  // 'h' = engaged horizontal drag; 'scroll' = the pointer went vertical on the
  // board, so the browser owns it (native pan-y scroll) and we stand down.
  let mode: 'h' | 'scroll' | null = null;
  let samples: Array<{ t: number; x: number; y: number }> = [];
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function clearVisual(el: HTMLElement, afterMs: number) {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      el.style.removeProperty('transition');
      el.style.removeProperty('transform');
      el.style.removeProperty('opacity');
      el.style.removeProperty('will-change');
    }, afterMs);
  }

  function springBack(el: HTMLElement) {
    el.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease-out';
    el.style.transform = 'translate(0px, 0px)';
    el.style.opacity = '1';
    clearVisual(el, 200);
  }

  // Page-turn: slide the whole station screen out, switch station, slide the
  // new one in (the header art/name and the board travel together).
  function commitStation(direction: -1 | 1) {
    const el = screenEl();
    if (!el) {
      press(direction > 0 ? 'next-station' : 'prev-station');
      return;
    }
    const width = root.clientWidth || 400;
    el.style.willChange = 'transform';
    el.style.transition = 'transform 130ms ease-in, opacity 130ms ease-in';
    el.style.transform = `translateX(${-direction * width * 0.3}px)`;
    el.style.opacity = '0';
    setTimeout(() => {
      press(direction > 0 ? 'next-station' : 'prev-station');
      el.style.transition = 'none';
      el.style.transform = `translateX(${direction * width * 0.26}px)`;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease-out';
          el.style.transform = 'translateX(0px)';
          el.style.opacity = '1';
          clearVisual(el, 220);
        }),
      );
    }, 135);
  }

  // Train walk: a shorter slide on just the board, then the arrow press.
  function commitTrain(direction: -1 | 1) {
    const el = boardEl();
    press(direction > 0 ? 'train-next' : 'train-prev');
    if (!el) return;
    el.style.willChange = 'transform';
    el.style.transition = 'none';
    el.style.transform = `translateX(${direction * 22}px)`;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        el.style.transform = 'translateX(0px)';
        clearVisual(el, 220);
      }),
    );
  }

  // A drag that engaged horizontally never counts as a tap: kill the trailing
  // click so a swipe released over a button does not also press it. Synthetic
  // presses from this module (dispatching=true) pass through untouched.
  function suppressNextClick() {
    const kill = (event: Event) => {
      if (dispatching) return;
      window.removeEventListener('click', kill, { capture: true });
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    window.addEventListener('click', kill, { capture: true });
    setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 150);
  }

  function velocity(): { vx: number } {
    if (samples.length < 2) return { vx: 0 };
    const a = samples[0];
    const b = samples[samples.length - 1];
    const dt = Math.max(1, b.t - a.t);
    return { vx: (b.x - a.x) / dt };
  }

  function regionOf(target: Element): 'header' | 'board' | 'sheet' | null {
    if (target.closest('[data-testid="station-header"]')) return 'header';
    if (target.closest('[data-testid="board-content"]')) return 'board';
    if (onTrip() || onStations() || onSettings()) return 'sheet';
    return onHome() ? 'board' : null;
  }

  function onPointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as Element).closest('input, textarea, select')) return;
    pointerId = event.pointerId;
    x0 = event.clientX;
    y0 = event.clientY;
    dx = 0;
    dy = 0;
    mode = null;
    region = regionOf(event.target as Element);
    samples = [{ t: performance.now(), x: x0, y: y0 }];
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId || mode === 'scroll') return;
    dx = event.clientX - x0;
    dy = event.clientY - y0;
    samples.push({ t: performance.now(), x: event.clientX, y: event.clientY });
    if (samples.length > 6) samples.shift();

    if (!mode) {
      if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy) * 1.25) {
        mode = 'h';
        try {
          root.setPointerCapture(pointerId);
        } catch {
          /* capture is best-effort */
        }
      } else if (Math.abs(dy) > SLOP_PX + 2 && Math.abs(dy) > Math.abs(dx) * 1.25) {
        // Vertical movement belongs to native scrolling (board) or nothing
        // (header/sheets): disengage for the rest of this pointer.
        mode = 'scroll';
        return;
      }
    }

    if (mode !== 'h') return;
    if (region === 'header' && onHome()) {
      const el = screenEl();
      if (!el) return;
      const width = root.clientWidth || 400;
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx * 0.9}px)`;
      el.style.opacity = String(1 - Math.min((Math.abs(dx) / width) * 0.5, 0.35));
    } else if (region === 'board' && onHome()) {
      const el = boardEl();
      if (!el) return;
      const damped = Math.max(-34, Math.min(34, dx * 0.25));
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transform = `translateX(${damped}px)`;
    }
  }

  function endGesture(event: PointerEvent, cancelled: boolean) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const engaged = mode;
    const from = region;
    const { vx } = velocity();
    pointerId = null;
    mode = null;
    region = null;
    try {
      root.releasePointerCapture(event.pointerId);
    } catch {
      /* not captured */
    }
    if (engaged !== 'h') return;

    const visual = from === 'header' ? screenEl() : from === 'board' ? boardEl() : null;
    if (cancelled) {
      if (visual) springBack(visual);
      return;
    }

    suppressNextClick();
    const commit = Math.abs(dx) > H_COMMIT_PX || Math.abs(vx) > H_COMMIT_VELOCITY;
    if (!commit) {
      if (visual) springBack(visual);
      return;
    }

    if (from === 'sheet') {
      if (dx > 0) {
        if (onTrip()) return press('trip-back');
        if (onStations()) return press('stations-back');
        if (onSettings()) return press('settings-back');
      }
      return;
    }
    if (!onHome()) return;
    if (from === 'header') {
      commitStation(dx < 0 ? 1 : -1);
      return;
    }
    if (from === 'board') {
      // Later trains live to the right: swiping left pulls the next one in.
      commitTrain(dx < 0 ? 1 : -1);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('input, textarea, select')) {
      if (event.key === 'Escape') (target as HTMLElement).blur();
      return;
    }
    if (onHome()) {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          return press('train-prev');
        case 'ArrowRight':
          event.preventDefault();
          return press('train-next');
        case 'ArrowUp':
          event.preventDefault();
          return press('prev-station');
        case 'ArrowDown':
          event.preventDefault();
          return press('next-station');
        case 'Enter':
          return press('hero-departure');
        case 'f':
        case 'F':
          return press('flip-direction');
        case 'r':
        case 'R':
          return press('refresh');
        case 's':
        case 'S':
          return press('change-station');
        case 'g':
        case 'G':
          return press('open-settings');
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      press(onTrip() ? 'trip-back' : onSettings() ? 'settings-back' : 'stations-back');
    }
  }

  const onPointerUp = (event: PointerEvent) => endGesture(event, false);
  const onPointerCancel = (event: PointerEvent) => endGesture(event, true);

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onKeyDown);
    if (settleTimer) clearTimeout(settleTimer);
  };
}
