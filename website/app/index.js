// Homepage for https://snapback.expo.app
//
// The hero is the cap reveal built by `brand/cap/build.mjs` and served as a
// static asset at /cap/. It is embedded with an <iframe> rather than bundled so
// the WebGL scene stays isolated from the site bundle and can be rebuilt on its
// own; `#hero` strips its studio chrome and holds the finished lockup, which
// doubles as the page's logotype. The frame takes no pointer events — it must
// never swallow a scroll gesture on touch — so replay and theme are driven from
// here over postMessage. This app is web-only (app.json platforms), so the page
// is written as plain DOM.
import { useCallback, useEffect, useRef, useState } from "react";

const GUIDE = "/latest/";
const DOCS = "/docs/";
const REPO = "https://github.com/expo/snapback";
const STARS_API = "https://api.github.com/repos/expo/snapback";
const THEME_KEY = "snapback-theme";
const THEMES = ["system", "light", "dark"];

export default function Home() {
  const frame = useRef(null);
  const [theme, setTheme] = useState("system");
  const [stars, setStars] = useState(null);

  const tell = useCallback((msg) => {
    const w = frame.current && frame.current.contentWindow;
    if (w) w.postMessage(msg, "*");
  }, []);

  // Restore the stored choice, and answer the frame when it says it is up.
  useEffect(() => {
    let stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch {}
    const next = THEMES.indexOf(stored) >= 0 ? stored : "system";
    setTheme(next);
    applyTheme(next);

    const onMessage = (e) => {
      if (e.data && e.data.snapback === "ready") tell({ snapback: "theme", value: next });
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [tell]);

  const chooseTheme = (next) => {
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    tell({ snapback: "theme", value: next });
  };

  // Unauthenticated GitHub allows CORS but 404s while the repo is private, so
  // the count simply stays hidden until it is public. The link always works.
  useEffect(() => {
    let live = true;
    try {
      const cached = sessionStorage.getItem("snapback-stars");
      if (cached) setStars(Number(cached));
    } catch {}
    fetch(STARS_API)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d || typeof d.stargazers_count !== "number") return;
        setStars(d.stargazers_count);
        try { sessionStorage.setItem("snapback-stars", String(d.stargazers_count)); } catch {}
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <>
      <title>Snapback — an agent native backend for apps used by humans and agents</title>
      <meta
        name="description"
        content="An agent native, open source, scale-to-zero backend for apps used by humans and agents."
      />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="icon" href="/favicon.ico" sizes="any" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="page">
        <header className="bar">
          <a className="byExpo" href="https://expo.dev" title="Made by Expo">
            <svg className="expoMark" viewBox="0 0 652 606" aria-hidden="true">
              <path d={EXPO_PATH} />
            </svg>
            <span>Made by Expo</span>
          </a>

          <div className="barRight">
            <a className="gh" href={REPO} title="Snapback on GitHub">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d={GITHUB_PATH} /></svg>
              <span className="ghLabel">GitHub</span>
              {stars !== null && <span className="stars">★ {formatStars(stars)}</span>}
            </a>

            <div className="themes" role="group" aria-label="Colour theme">
              {THEMES.map((t) => (
                <button
                  key={t}
                  className="themeBtn"
                  aria-label={t[0].toUpperCase() + t.slice(1)}
                  title={t[0].toUpperCase() + t.slice(1)}
                  aria-pressed={theme === t}
                  onClick={() => chooseTheme(t)}
                >
                  <ThemeIcon kind={t} />
                </button>
              ))}
            </div>
          </div>
        </header>

        <section className="hero">
          <iframe
            ref={frame}
            className="heroFrame"
            src="/cap/#hero"
            title="An Expo cap turns to its adjuster strap, where the snaps close into the Snapback mark"
            scrolling="no"
            onLoad={() => tell({ snapback: "theme", value: theme })}
          />
          <button
            className="heroHit"
            title="Replay"
            aria-label="Replay the reveal"
            onClick={() => tell({ snapback: "replay" })}
          />
        </section>

        <main className="body">
          <h1 className="statement">
            <span className="lead">An</span>{" "}
            <em>agent native</em>,<br />
            <em>open source</em>,<br />
            <em>scale-to-zero</em><br />
            <span className="lead">backend for apps used by</span>{" "}
            <em>humans&nbsp;and&nbsp;agents</em>.
          </h1>

          <p className="sub">
            Server-authoritative data, live queries, ephemeral realtime, typed
            assets, and honest offline — with first-party Expo, React, Swift,
            and headless clients.
          </p>

          <div className="actions">
            <a className="btn primary" href={GUIDE}>Read the guide</a>
            <a className="btn" href={DOCS}>Docs</a>
          </div>

          <code className="install">npm create snapback-app@latest</code>

          <p className="foot">
            Agents: start at <a href="/llms.txt">/llms.txt</a>
          </p>
        </main>
      </div>
    </>
  );
}

function applyTheme(t) {
  const el = document.documentElement;
  if (t === "light" || t === "dark") el.dataset.theme = t;
  else delete el.dataset.theme;
}

const formatStars = (n) =>
  n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);

function ThemeIcon({ kind }) {
  const common = {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
  };
  if (kind === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" />
      </svg>
    );
  }
  if (kind === "dark") {
    return (
      <svg {...common}>
        <path d="M20.5 13.2A8.4 8.4 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4.5" width="18" height="12.5" rx="2.2" />
      <path d="M9 20.5h6" />
    </svg>
  );
}

// Expo's mark, verbatim from the icon asset.
const EXPO_PATH =
  "M353.554 0H298.446C273.006 0 249.684 14.6347 237.962 37.9539L4.37994 502.646C-1.04325 513.435 -1.45067 526.178 3.2716 537.313L22.6123 582.918C34.6475 611.297 72.5404 614.156 88.4414 587.885L309.863 222.063C313.34 216.317 319.439 212.826 326 212.826C332.561 212.826 338.659 216.317 342.137 222.063L563.559 587.885C579.46 614.156 617.352 611.297 629.388 582.918L648.728 537.313C653.451 526.178 653.043 513.435 647.62 502.646L414.038 37.9539C402.316 14.6347 378.994 0 353.554 0Z";

const GITHUB_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z";

/* Light is the base; the dark palette redefines tokens only, in all three
   states (system-dark, explicit dark, explicit light beating a dark OS). The
   ground colour has to match /cap/ exactly or the iframe seam shows. */
const CSS = `
:root {
  --ground: #FBFBFA;
  --ink: #111111;
  --muted: #6A6E76;
  --faint: #9A9EA6;
  --line: rgba(20,22,26,.14);
  --hover: rgba(20,22,26,.045);
  --accent: #B4700F;
  --underline: rgba(180,112,15,.30);
  --sans: "Avenir Next", Avenir, "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0C0D0F;
    --ink: #F2F2F4;
    --muted: #8C9099;
    --faint: #6A6E76;
    --line: rgba(255,255,255,.14);
    --hover: rgba(255,255,255,.06);
    --accent: #E9A63C;
    --underline: rgba(233,166,60,.34);
  }
}
:root[data-theme="dark"] {
  --ground: #0C0D0F;
  --ink: #F2F2F4;
  --muted: #8C9099;
  --faint: #6A6E76;
  --line: rgba(255,255,255,.14);
  --hover: rgba(255,255,255,.06);
  --accent: #E9A63C;
  --underline: rgba(233,166,60,.34);
}

* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; background: var(--ground); }
body {
  color: var(--ink);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }

.page { display: flex; flex-direction: column; min-height: 100vh; }

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 22px 4px;
}
.byExpo {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--muted);
  text-decoration: none;
}
.byExpo:hover { color: var(--ink); }
.expoMark { width: 15px; height: 14px; fill: currentColor; }

.barRight { display: flex; align-items: center; gap: 10px; }

.gh {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 13px;
  color: var(--muted);
  text-decoration: none;
}
.gh:hover { color: var(--ink); background: var(--hover); }
.gh svg { width: 15px; height: 15px; fill: currentColor; }
.stars {
  padding-left: 8px;
  border-left: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}

.themes {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 999px;
}
.themeBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--faint);
  cursor: pointer;
}
.themeBtn svg { width: 15px; height: 15px; }
.themeBtn:hover { color: var(--ink); }
.themeBtn[aria-pressed="true"] { background: var(--hover); color: var(--ink); }

.hero {
  position: relative;
  width: 100%;
  height: clamp(330px, 58vh, 580px);
  background: var(--ground);
}
.heroFrame { display: block; width: 100%; height: 100%; border: 0; pointer-events: none; }
/* Click anywhere on the reveal — including the finished lockup — to replay it. */
.heroHit {
  position: absolute;
  inset: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.body {
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
  padding: 8px 28px 72px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 26px;
}

/* The three attributes are the point of the sentence, so each takes its own
   line and the connective words step back in size and weight. */
.statement {
  margin: 0;
  font-size: clamp(30px, 5.4vw, 52px);
  font-weight: 600;
  line-height: 1.14;
  letter-spacing: -0.022em;
  text-wrap: balance;
}
.statement em {
  font-style: normal;
  font-weight: 600;
  color: var(--ink);
  box-shadow: inset 0 -0.09em 0 var(--underline);
}
.statement .lead {
  font-size: 0.52em;
  font-weight: 500;
  line-height: 1;
  color: var(--muted);
  letter-spacing: -0.005em;
}

.sub {
  margin: 0;
  max-width: 62ch;
  font-size: 17px;
  line-height: 1.62;
  color: var(--muted);
}

.actions { display: flex; flex-wrap: wrap; gap: 12px; }
.btn {
  display: inline-flex;
  align-items: center;
  height: 44px;
  padding: 0 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
  color: var(--ink);
  background: transparent;
  transition: background .15s, border-color .15s;
}
.btn:hover { background: var(--hover); }
.btn.primary { background: var(--ink); border-color: var(--ink); color: var(--ground); }
.btn.primary:hover { opacity: .86; }

.install {
  font-family: var(--mono);
  font-size: 13.5px;
  color: var(--ink);
  background: var(--hover);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 11px 15px;
}

.foot { margin: 0; font-size: 13px; color: var(--faint); }
.foot a { color: var(--muted); font-family: var(--mono); }

@media (max-width: 700px) {
  .bar { padding: 12px 18px 2px; }
  .byExpo span { display: none; }
  .ghLabel { display: none; }
  .hero { height: clamp(290px, 44vh, 400px); }
  .body { padding: 4px 22px 56px; gap: 22px; }
  .sub { font-size: 16px; }
}
`;
