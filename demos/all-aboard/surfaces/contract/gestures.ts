// All Aboard — web gesture glue (LLP 0027 interaction model; LLP 0029 G1;
// gesture zones redesigned under ENG-23719; contiguous paging under
// ENG-23795).
//
// Contract has no swipe/pan primitive (the event vocabulary is press-family
// only), so the gesture-first interaction ships as WEB SURFACE GLUE over the
// DOM mirror. Gestures are REGION-scoped:
//
//   - the red station header clips a declared 3-cell pager strip
//     ([station-pager]; the adjacent stations' cards physically at ±100%):
//     horizontal drags move the strip 1:1 with the finger — the neighbor card
//     is already there, native-paging style — and a commit settles the strip
//     onto the neighbor before pressing the matching edge chevron;
//   - the departures board pages the selected train the same way through the
//     [hero-pager] strip (earlier trains to the left, later to the right);
//     vertical movement there is NATIVE scrolling — the glue must never
//     capture it (board-content declares touch-action: pan-y in main.ts);
//   - the sheet screens (stations / settings / trip) go back on swipe right;
//   - arrow keys mirror the zones for desktop: ←/→ earlier/later train,
//     ↑/↓ previous/next station (the corridor runs north→south);
//   - tapping a compact train row morphs it into the hero card via the View
//     Transitions API (fast, 170ms; no-op without browser support or under
//     prefers-reduced-motion) — see onCaptureClick below;
//   - trackpad two-finger swipes mirror the drag zones too: they arrive as
//     WHEEL events (no pointer sequence), so a horizontal wheel gesture over
//     the board pages the train and over the header pages the station —
//     without this, "swipe anywhere in the white area" works on touch but
//     silently does nothing on a Mac trackpad. Vertical wheel stays native
//     scroll; a commit locks briefly so one physical swipe pages once.
//
// Dispatch is deliberately dumb: every recognized gesture CLICKS a visible
// press affordance the .contract declares — the header edge chevrons, the
// compact train rows adjacent to the hero (testIds train-prev / train-next
// since ENG-23795 removed the arrow buttons), the footer direction switch,
// Back. Gestures, taps, keyboard, acceptance tests, and the native host
// therefore drive one action path, and the gesture layer holds zero app
// state. When Exact grows real gesture primitives (the motion RFCs; LLP 0029
// G1), this file is deleted and swipe= attributes replace it.
//
// Visual feedback owns only inline transform/transition on the pager strips,
// whose Contract props are static — the DOM mirror re-applies styles just for
// nodes whose props object changed, so glue-owned inline styles survive the
// 1s tick re-renders; they are cleared after every settle animation
// regardless. NO fade-out/fade-in: paging is a continuous slide between
// physically adjacent cards (ENG-23795).

type Cleanup = () => void;

const SLOP_PX = 12;
const H_COMMIT_PX = 64;
const H_COMMIT_VELOCITY = 0.5; // px/ms
const SETTLE_MS = 200;

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
  const stationPagerEl = () => q('station-pager');
  const heroPagerEl = () => q('hero-pager');
  const onHome = () => !!q('station-screen');
  const onTrip = () => !!q('trip-screen');
  const onStations = () => !!q('stations-screen');
  const onSettings = () => !!q('settings-screen');
  const directionsOpen = () => !!q('directions-sheet');

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
      el.style.removeProperty('will-change');
    }, afterMs);
  }

  function springBack(el: HTMLElement) {
    el.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    el.style.transform = 'translateX(0px)';
    clearVisual(el, 200);
  }

  // Whether the strip has a physically adjacent card in this direction (the
  // .contract only declares the cell when a neighbor exists). Without one the
  // drag rubber-bands instead of paging into blank space.
  function hasCell(strip: 'station' | 'hero', direction: -1 | 1): boolean {
    const side = direction > 0 ? 'next' : 'prev';
    return !!q(strip === 'station' ? `header-cell-${side}` : `hero-cell-${side}`);
  }

  // Finger-follow: 1:1 while a neighbor card exists, damped rubber-band at
  // the corridor/list edge.
  function dragStrip(el: HTMLElement, strip: 'station' | 'hero', delta: number) {
    const bounded = hasCell(strip, delta < 0 ? 1 : -1) ? delta : Math.max(-42, Math.min(42, delta * 0.28));
    el.style.willChange = 'transform';
    el.style.transition = 'none';
    el.style.transform = `translateX(${bounded}px)`;
  }

  // Contiguous page-turn (ENG-23795): settle the strip onto the adjacent
  // card, then dispatch the same press affordance a tap would use; the fresh
  // render is centered on the new page, so the transform resets invisibly.
  // Without a declared neighbor cell (corridor/list edge — the chevron press
  // affordance still exists there but is a no-op) the strip must not settle
  // into blank space: spring back instead.
  function commitPage(el: HTMLElement | null, strip: 'station' | 'hero', direction: -1 | 1, targetId: string) {
    const target = q(targetId);
    if (!el) {
      if (target) press(targetId);
      return;
    }
    if (!target || !hasCell(strip, direction)) {
      springBack(el);
      return;
    }
    const width = el.clientWidth || root.clientWidth || 400;
    el.style.willChange = 'transform';
    el.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
    el.style.transform = `translateX(${-direction * width}px)`;
    setTimeout(() => {
      press(targetId);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.transition = 'none';
          el.style.transform = 'translateX(0px)';
          clearVisual(el, 40);
        }),
      );
    }, SETTLE_MS + 10);
  }

  const commitStation = (direction: -1 | 1) =>
    commitPage(stationPagerEl(), 'station', direction, direction > 0 ? 'next-station' : 'prev-station');
  // Later trains live to the right: swiping left pulls the next one in. The
  // press targets are the compact rows adjacent to the hero (ENG-23795).
  const commitTrain = (direction: -1 | 1) =>
    commitPage(heroPagerEl(), 'hero', direction, direction > 0 ? 'train-next' : 'train-prev');

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
    if (target.closest('[data-testid="directions-sheet"], [data-testid="sticky-footer"]')) return null;
    if (target.closest('[data-testid="station-header"]')) return 'header';
    if (target.closest('[data-testid="board-content"]')) return 'board';
    if (onTrip() || onStations() || onSettings()) return 'sheet';
    return onHome() ? 'board' : null;
  }

  function onPointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as Element).closest('input, textarea, select')) return;
    if (directionsOpen()) return;
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
      const el = stationPagerEl();
      if (el) dragStrip(el, 'station', dx);
    } else if (region === 'board' && onHome()) {
      const el = heroPagerEl();
      if (el) dragStrip(el, 'hero', dx);
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

    const visual = from === 'header' ? stationPagerEl() : from === 'board' ? heroPagerEl() : null;
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
      commitTrain(dx < 0 ? 1 : -1);
    }
  }

  // Trackpad two-finger swipes: WheelEvents, not pointers. Accumulate the
  // horizontal delta and page on a threshold; a short lockout after a commit
  // (plus a quiet-period reset) turns one physical swipe's event burst into
  // exactly one page turn. deltaX > 0 is "fingers swept left" (content moves
  // toward the right side), which matches drag-left: the next train/station.
  const WHEEL_COMMIT_PX = 70;
  const WHEEL_LOCK_MS = 450;
  const WHEEL_QUIET_MS = 250;
  let wheelAccumX = 0;
  let wheelLockUntil = 0;
  let wheelQuietTimer: ReturnType<typeof setTimeout> | null = null;

  function onWheel(event: WheelEvent) {
    if (!onHome() || directionsOpen()) return;
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    const from = regionOf(target);
    if (from !== 'board' && from !== 'header') return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.25) return; // vertical scroll stays native
    // Ours now: keep the browser's horizontal-overscroll history navigation
    // from also firing on the same gesture.
    event.preventDefault();
    const now = performance.now();
    if (now < wheelLockUntil) return;
    wheelAccumX += event.deltaX;
    if (wheelQuietTimer) clearTimeout(wheelQuietTimer);
    wheelQuietTimer = setTimeout(() => {
      wheelAccumX = 0;
    }, WHEEL_QUIET_MS);
    if (Math.abs(wheelAccumX) < WHEEL_COMMIT_PX) return;
    const direction: -1 | 1 = wheelAccumX > 0 ? 1 : -1;
    wheelAccumX = 0;
    wheelLockUntil = now + WHEEL_LOCK_MS;
    if (from === 'header') commitStation(direction);
    else commitTrain(direction);
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target as Element | null;
    if (target && typeof target.closest === 'function' && target.closest('input, textarea, select')) {
      if (event.key === 'Escape') (target as HTMLElement).blur();
      return;
    }
    if (directionsOpen()) {
      if (event.key === 'Escape') press('directions-cancel');
      return;
    }
    if (onHome()) {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          return commitTrain(-1);
        case 'ArrowRight':
          event.preventDefault();
          return commitTrain(1);
        case 'ArrowUp':
          event.preventDefault();
          return commitStation(-1);
        case 'ArrowDown':
          event.preventDefault();
          return commitStation(1);
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

  // Tap-to-select morph: selecting a train from a compact row animates the
  // row expanding into the hero card (and the old hero collapsing away)
  // through the View Transitions API — a fast 170ms morph (duration set in
  // main.ts CSS), not a fade. Progressive enhancement: browsers without
  // startViewTransition, prefers-reduced-motion users, and gesture-driven
  // presses (dispatching=true — the pager strip already animates those via
  // transforms) all get the plain instant update. The captured click is
  // re-dispatched inside the transition callback; the runtime flushes state
  // on a microtask, so one macrotask later the new tree is in the DOM and
  // the named elements pair up: tapped row (old) -> hero card (new).
  const reducedMotion =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let morphing = false;

  function onCaptureClick(event: MouseEvent) {
    if (dispatching || morphing || reducedMotion) return;
    const doc = document as Document & {
      startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
    };
    if (typeof doc.startViewTransition !== 'function') return;
    if (!onHome() || directionsOpen()) return;
    const target = event.target;
    if (!(target instanceof Element) || typeof target.closest !== 'function') return;
    const row = target.closest('[data-testid^="train-"]');
    if (!(row instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const oldHero = q('hero-departure');
    row.style.viewTransitionName = 'aa-train-in';
    if (oldHero) oldHero.style.viewTransitionName = 'aa-train-out';
    morphing = true;
    const transition = doc.startViewTransition(async () => {
      dispatching = true;
      try {
        row.click();
      } finally {
        dispatching = false;
      }
      // One macrotask: the runtime flushes the press's state write on a
      // microtask, so the new tree is committed by the time this resolves.
      // (No rAF here — rendering is suppressed inside the capture phase.)
      await new Promise((resolve) => setTimeout(resolve, 0));
      q('hero-departure')?.style.setProperty('view-transition-name', 'aa-train-in');
    });
    transition.finished.catch(() => {}).finally(() => {
      morphing = false;
      row.style.removeProperty('view-transition-name');
      oldHero?.style.removeProperty('view-transition-name');
      q('hero-departure')?.style.removeProperty('view-transition-name');
    });
  }

  const onPointerUp = (event: PointerEvent) => endGesture(event, false);
  const onPointerCancel = (event: PointerEvent) => endGesture(event, true);

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('click', onCaptureClick, true);
  window.addEventListener('keydown', onKeyDown);

  return () => {
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('click', onCaptureClick, true);
    window.removeEventListener('keydown', onKeyDown);
    if (settleTimer) clearTimeout(settleTimer);
    if (wheelQuietTimer) clearTimeout(wheelQuietTimer);
  };
}
