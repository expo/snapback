// All Aboard — web gesture glue (LLP 0027 interaction model; LLP 0029 G1).
//
// Contract has no swipe/pan primitive (the event vocabulary is press-family
// only), so the gesture-first interaction ships as WEB SURFACE GLUE over the
// DOM mirror: pointer tracking recognizes horizontal swipes (adjacent station,
// with finger-follow drag and a page-turn settle), vertical swipes (walk the
// upcoming trains), the bare tap (flip direction), and swipe-right-to-go-back
// on the sheet screens, plus arrow-key equivalents for desktop.
//
// Dispatch is deliberately dumb: every recognized gesture CLICKS the same
// visible press affordance the .contract declares (edge chevrons, ▲▼ train
// arrows, the flip pill, Back). Gestures, taps, keyboard, acceptance tests,
// and the native host therefore drive one action path, and the gesture layer
// holds zero app state. When Exact grows real gesture primitives (the motion
// RFCs; LLP 0029 G1), this file is deleted and swipe= attributes replace it.
//
// Visual feedback owns only inline transform/opacity/transition on nodes whose
// Contract props are static — the DOM mirror re-applies styles just for nodes
// whose props object changed, so glue-owned inline styles survive the 1s tick
// re-renders; they are cleared after every settle animation regardless.

type Cleanup = () => void;

const SLOP_PX = 12;
const H_COMMIT_PX = 70;
const H_COMMIT_VELOCITY = 0.5; // px/ms
const V_COMMIT_PX = 46;
const V_COMMIT_VELOCITY = 0.45;
const TAP_MS = 400;
const TAP_PX = 9;

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
  const content = () => q('board-content');
  const onHome = () => !!q('board-content');
  const onTrip = () => !!q('trip-screen');
  const onStations = () => !!q('stations-screen');

  let pointerId: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let dx = 0;
  let dy = 0;
  let mode: 'h' | 'v' | null = null;
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

  // Page-turn: slide the board out, switch station, slide the new one in.
  function commitStation(direction: -1 | 1) {
    const el = content();
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

  // A drag that engaged h/v never counts as a tap: kill the trailing click so
  // a swipe released over a button does not also press it. Synthetic presses
  // from this module (dispatching=true) pass through untouched.
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

  function velocity(): { vx: number; vy: number } {
    if (samples.length < 2) return { vx: 0, vy: 0 };
    const a = samples[0];
    const b = samples[samples.length - 1];
    const dt = Math.max(1, b.t - a.t);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  function onPointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as Element).closest('input, textarea, select')) return;
    pointerId = event.pointerId;
    x0 = event.clientX;
    y0 = event.clientY;
    t0 = performance.now();
    dx = 0;
    dy = 0;
    mode = null;
    samples = [{ t: t0, x: x0, y: y0 }];
  }

  function onPointerMove(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    dx = event.clientX - x0;
    dy = event.clientY - y0;
    samples.push({ t: performance.now(), x: event.clientX, y: event.clientY });
    if (samples.length > 6) samples.shift();

    if (!mode) {
      if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy) * 1.25) mode = 'h';
      else if (Math.abs(dy) > SLOP_PX + 2 && Math.abs(dy) > Math.abs(dx) * 1.25) mode = 'v';
      if (mode) {
        try {
          root.setPointerCapture(pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
    }

    const el = onHome() ? content() : null;
    if (!el) return;
    if (mode === 'h') {
      const width = root.clientWidth || 400;
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transform = `translateX(${dx * 0.9}px)`;
      el.style.opacity = String(1 - Math.min((Math.abs(dx) / width) * 0.5, 0.35));
    } else if (mode === 'v') {
      const damped = Math.max(-26, Math.min(26, dy * 0.22));
      el.style.willChange = 'transform';
      el.style.transition = 'none';
      el.style.transform = `translateY(${damped}px)`;
    }
  }

  function endGesture(event: PointerEvent, cancelled: boolean) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    const engaged = mode;
    const { vx, vy } = velocity();
    pointerId = null;
    mode = null;
    try {
      root.releasePointerCapture(event.pointerId);
    } catch {
      /* not captured */
    }

    const el = onHome() ? content() : null;
    if (cancelled) {
      if (el && engaged) springBack(el);
      return;
    }

    if (engaged === 'h') {
      suppressNextClick();
      const commit = Math.abs(dx) > H_COMMIT_PX || Math.abs(vx) > H_COMMIT_VELOCITY;
      if (commit && dx > 0 && onTrip()) return press('trip-back');
      if (commit && dx > 0 && onStations()) return press('stations-back');
      if (el) {
        if (commit) commitStation(dx < 0 ? 1 : -1);
        else springBack(el);
      }
      return;
    }

    if (engaged === 'v') {
      suppressNextClick();
      if (onHome()) {
        const commit = Math.abs(dy) > V_COMMIT_PX || Math.abs(vy) > V_COMMIT_VELOCITY;
        // Swipe up pulls the NEXT (later) train into the hero slot.
        if (commit) press(dy < 0 ? 'train-next' : 'train-prev');
        if (el) springBack(el);
      }
      return;
    }

    // No gesture engaged: a quick, still press on neutral ground flips the
    // direction (LLP 0027 "tap with no other tap target").
    const dt = performance.now() - t0;
    if (onHome() && dt < TAP_MS && Math.hypot(dx, dy) < TAP_PX) {
      const target = event.target as Element;
      if (!target.closest('button, a, input, textarea, select, [role="button"]')) {
        press('flip-direction');
      }
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
          return press('prev-station');
        case 'ArrowRight':
          event.preventDefault();
          return press('next-station');
        case 'ArrowUp':
          event.preventDefault();
          return press('train-prev');
        case 'ArrowDown':
          event.preventDefault();
          return press('train-next');
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
      }
      return;
    }
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      press(onTrip() ? 'trip-back' : 'stations-back');
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
