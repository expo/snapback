// Renders benchmarks/TREND.json as one self-contained page.
// Called by score-trend.mjs; writes benchmarks/TREND.html.

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sign = v => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);

/** A category's direction, by the correction's own bar: drift larger than the series' own sd. */
function state(t) {
  if (!t.beyondNoise) return "flat";
  if (!t.robust) return "fragile";
  return t.slope < 0 ? "falling" : "rising";
}

/** Points for a series inside a w×h box, with its own y-domain. */
function points(series, w, h, pad) {
  const lo = Math.min(...series), hi = Math.max(...series);
  const span = hi - lo || 1;
  const x = i => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = v => pad + (1 - (v - lo) / span) * (h - pad * 2);
  return { x, y, lo, hi };
}

function sparkline(t, w = 150, h = 40) {
  const { x, y } = points(t.series, w, h, 5);
  const raw = t.series.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const fit = `${x(0)},${y(t.first)} ${x(t.series.length - 1)},${y(t.last)}`;
  const last = t.series.length - 1;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t.series.join(", ")}">
      <polyline class="raw" points="${raw}" fill="none" />
      <polyline class="fit" points="${fit}" fill="none" />
      <circle class="end" cx="${x(last)}" cy="${y(t.series[last])}" r="3" />
    </svg>`;
}

function hero(t, runs) {
  const w = 720, h = 260, padX = 48, padY = 28;
  const lo = Math.min(...t.series) - 1, hi = Math.max(...t.series) + 1;
  const span = hi - lo;
  const x = i => padX + (i / (t.series.length - 1)) * (w - padX - 20);
  const y = v => padY + (1 - (v - lo) / span) * (h - padY * 2);
  const dmin = Math.min(...t.series), dmax = Math.max(...t.series);
  const ticks = [dmin, Math.round((dmin + dmax) / 2), dmax].filter((v, i, a) => a.indexOf(v) === i);
  const grid = ticks.map(v => `<line class="grid" x1="${padX}" y1="${y(v)}" x2="${w - 20}" y2="${y(v)}" />
      <text class="tick" x="${padX - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");
  const raw = t.series.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = t.series.length - 1;
  const dots = t.series.map((v, i) => `<circle class="pt" cx="${x(i)}" cy="${y(v)}" r="${i === last ? 5 : 3.5}" data-i="${i}" />`).join("");
  const hits = runs.map((r, i) => `<rect class="hit" x="${x(i) - 18}" y="${padY - 10}" width="36" height="${h - padY * 2 + 20}" data-i="${i}" data-v="${esc(r.version)}" data-s="${t.series[i]}" data-d="${esc(r.date)}" />`).join("");
  const versions = runs.map((r, i) =>
    (i === 0 || i === last || i % 3 === 0)
      ? `<text class="vlabel" x="${x(i)}" y="${h - 6}" text-anchor="middle">${esc(r.version)}</text>` : "").join("");
  return `<svg id="hero" viewBox="0 0 ${w} ${h}" role="img" aria-label="Overall score across ${t.series.length} runs: ${t.series.join(", ")}">
      ${grid}
      <line class="fit" x1="${x(0)}" y1="${y(t.first)}" x2="${x(last)}" y2="${y(t.last)}" />
      <polyline class="raw" points="${raw}" fill="none" />
      ${dots}${versions}
      <text class="fitlabel" x="${x(last)}" y="${y(t.last) + 17}" text-anchor="end">fitted ${t.last.toFixed(1)}</text>
      ${hits}
    </svg>`;
}

export function page(report) {
  const { runs, categories, falling } = report;
  const overall = categories.overall;
  const n = runs.length;
  const order = Object.keys(categories).filter(c => c !== "overall").sort((a, b) => categories[a].drift - categories[b].drift);
  const dir = state(overall);
  const fragile = report.fragile ?? [];

  const cards = order.map(c => {
    const t = categories[c];
    const s = state(t);
    return `<article class="card ${s}">
        <header>
          <h3>${esc(c.replace(/_/g, " "))}</h3>
          <span class="drift">${sign(t.drift)}</span>
        </header>
        ${sparkline(t)}
        <p class="range"><span>${t.first.toFixed(0)} → ${t.last.toFixed(0)}</span><span class="badge">${s === "fragile" ? `rests on ${esc(t.restsOn.join("/"))}` : s}</span></p>
        <p class="series">${t.series.join(" ")}</p>
      </article>`;
  }).join("");

  const rows = order.concat(["overall"]).map(c => {
    const t = categories[c];
    return `<tr class="${state(t)}"><th scope="row">${esc(c.replace(/_/g, " "))}</th>${t.series.map(v => `<td>${v}</td>`).join("")}<td class="n">${sign(t.slope)}</td><td class="n">${sign(t.drift)}</td><td class="n">${t.sd.toFixed(2)}</td><td>${state(t)}</td></tr>`;
  }).join("");

  return `<title>Clique Calibration Trend</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root{
    --ground:#F4F6F8; --surface:#FFFFFF; --raised:#EDF1F4;
    --ink:#111820; --ink2:#54616E; --ink3:#8B96A1;
    --rule:#DDE3E9; --rule2:#C9D2DA;
    --falling:#B03A2E; --rising:#06699B; --flatc:#7A8794;
    --sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
    --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  @media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
    --ground:#0E1317; --surface:#161C22; --raised:#1D242B;
    --ink:#E8EDF2; --ink2:#9AA7B4; --ink3:#69757F;
    --rule:#242C34; --rule2:#333D46;
    --falling:#DE6A53; --rising:#3B9FCE; --flatc:#7E8B97;
  }}
  :root[data-theme="dark"]{
    --ground:#0E1317; --surface:#161C22; --raised:#1D242B;
    --ink:#E8EDF2; --ink2:#9AA7B4; --ink3:#69757F;
    --rule:#242C34; --rule2:#333D46;
    --falling:#DE6A53; --rising:#3B9FCE; --flatc:#7E8B97;
  }
  body{background:var(--ground);color:var(--ink);font-family:var(--sans);line-height:1.5;
       padding-inline:20px;padding-block:0;-webkit-font-smoothing:antialiased}
  .wrap{max-width:860px;margin-inline:auto;padding-block:40px 64px;display:flex;flex-direction:column;gap:40px}
  h1{font-size:1.05rem;font-weight:600;margin:0;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2)}
  .sub{margin:6px 0 0;color:var(--ink3);font-size:.82rem;font-family:var(--mono)}

  .verdict{display:flex;flex-direction:column;gap:18px}
  .big{font-size:clamp(2.1rem,7vw,3.1rem);font-weight:600;line-height:1.05;margin:0;text-wrap:balance;
       letter-spacing:-.02em}
  .big em{font-style:normal;font-family:var(--mono);font-weight:500}
  .big.falling em{color:var(--falling)} .big.rising em{color:var(--rising)} .big.flat em{color:var(--flatc)}
  .lede{margin:0;max-width:62ch;color:var(--ink2)}

  figure{margin:0;background:var(--surface);border:1px solid var(--rule);border-radius:4px;padding:18px 14px 8px}
  #hero{width:100%;height:auto;display:block}
  #hero .grid{stroke:var(--rule);stroke-width:1}
  #hero .raw{stroke:var(--ink3);stroke-width:1.5;stroke-linejoin:round}
  #hero .pt{fill:var(--ink3)} #hero .pt:last-of-type{fill:var(--ink)}
  #hero .fit{stroke-width:2.5;stroke-linecap:round;stroke:var(--flatc)}
  figure.falling #hero .fit{stroke:var(--falling)}
  figure.rising #hero .fit{stroke:var(--rising)}
  figure.fragile #hero .fit{stroke:var(--flatc);stroke-dasharray:6 4}
  .tick,.vlabel,.fitlabel{font-family:var(--mono);font-size:10px;fill:var(--ink3)}
  .fitlabel{font-size:11px;fill:var(--flatc)}
  figure.falling .fitlabel{fill:var(--falling)}
  figure.rising .fitlabel{fill:var(--rising)}
  .hit{fill:transparent;cursor:crosshair}
  figcaption{font-family:var(--mono);font-size:.72rem;color:var(--ink3);padding:8px 4px 4px;
             display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}
  .key{display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:5px;background:var(--ink3)}
  .key.fit{height:2.5px;background:var(--flatc)}
  figure.falling .key.fit{background:var(--falling)}
  figure.rising .key.fit{background:var(--rising)}
  #tip{position:fixed;pointer-events:none;opacity:0;transition:opacity .1s;background:var(--ink);
       color:var(--ground);font-family:var(--mono);font-size:.72rem;padding:6px 9px;border-radius:3px;z-index:9}

  h2{font-size:.78rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);
     margin:0 0 14px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
  .grid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1px;
              background:var(--rule);border:1px solid var(--rule);border-radius:4px;overflow:hidden}
  .card{background:var(--surface);padding:14px 14px 12px;display:flex;flex-direction:column;gap:8px;
        border-left:3px solid transparent}
  .card.falling{border-left-color:var(--falling)}
  .card.rising{border-left-color:var(--rising)}
  .card.fragile{border-left-color:var(--flatc);border-left-style:dashed}
  .card.fragile .drift,.card.fragile .badge{color:var(--flatc)}
  .card.fragile .spark .fit{stroke:var(--flatc);stroke-dasharray:4 3}
  .fragile-note{margin:10px 4px 2px;font-size:.76rem;color:var(--ink2);max-width:60ch;
                border-top:1px solid var(--rule);padding-top:10px}
  .big.fragile em{color:var(--flatc)}
  .card header{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
  .card h3{font-size:.87rem;font-weight:500;margin:0}
  .drift{font-family:var(--mono);font-size:.87rem;font-variant-numeric:tabular-nums;color:var(--ink3)}
  .card.falling .drift{color:var(--falling)} .card.rising .drift{color:var(--rising)}
  .spark{width:100%;height:40px;display:block}
  .spark .raw{stroke:var(--ink3);stroke-width:1.25;stroke-linejoin:round}
  .spark .fit{stroke:var(--flatc);stroke-width:2;stroke-linecap:round}
  .card.falling .spark .fit{stroke:var(--falling)} .card.rising .spark .fit{stroke:var(--rising)}
  .spark .end{fill:var(--ink2)}
  .range{margin:0;display:flex;justify-content:space-between;align-items:center;gap:8px;
         font-family:var(--mono);font-size:.76rem;color:var(--ink2);font-variant-numeric:tabular-nums}
  .badge{font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3)}
  .card.falling .badge{color:var(--falling)} .card.rising .badge{color:var(--rising)}
  .series{margin:0;font-family:var(--mono);font-size:.68rem;color:var(--ink3);
          font-variant-numeric:tabular-nums;letter-spacing:.02em}

  .callout{background:var(--raised);border:1px solid var(--rule);border-left:3px solid var(--falling);
           border-radius:4px;padding:16px 18px}
  .callout p{margin:0;max-width:62ch}
  .callout p + p{margin-top:10px}
  .callout strong{font-weight:600}
  .callout .q{font-family:var(--mono);font-size:.82rem;color:var(--ink2)}

  details{background:var(--surface);border:1px solid var(--rule);border-radius:4px}
  summary{cursor:pointer;padding:12px 16px;font-size:.82rem;color:var(--ink2);font-weight:500}
  summary:focus-visible{outline:2px solid var(--rising);outline-offset:-2px}
  .tablewrap{overflow-x:auto;padding:0 16px 16px}
  table{border-collapse:collapse;font-family:var(--mono);font-size:.72rem;width:100%;
        font-variant-numeric:tabular-nums}
  th,td{padding:4px 7px;text-align:right;border-bottom:1px solid var(--rule);white-space:nowrap}
  th[scope=row]{text-align:left;font-weight:400;color:var(--ink2)}
  thead th{color:var(--ink3);font-weight:500;border-bottom:1px solid var(--rule2)}
  tr.falling th[scope=row]{color:var(--falling)} tr.rising th[scope=row]{color:var(--rising)}
  td.n{color:var(--ink)}

  footer{color:var(--ink3);font-size:.78rem;display:flex;flex-direction:column;gap:8px}
  footer code{font-family:var(--mono);font-size:.92em;background:var(--raised);padding:2px 5px;border-radius:3px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <header>
    <h1>Clique calibration trend</h1>
    <p class="sub">${n} Astra-medium runs · ${esc(runs[0].version)} → ${esc(runs[n - 1].version)} · generated ${esc(report.generated)}</p>
  </header>

  <section class="verdict">
    <p class="big ${falling.length ? "falling" : dir}">${falling.length
      ? `${falling.length} categor${falling.length === 1 ? "y survives" : "ies survive"} every way of cutting the series.`
      : `No category survives every way of cutting the series.`}</p>
    <p class="lede">A verdict counts here only if its drift beats its own noise, it holds when <strong>any single run</strong> is dropped, and it does not change when the series is started <strong>at any later run</strong>. ${fragile.length ? `${fragile.length} categor${fragile.length === 1 ? "y fails" : "ies fail"} one of those tests and ${fragile.length === 1 ? "is" : "are"} not counted.` : ""} Overall fits at ${sign(overall.slope)} a run, ${overall.first.toFixed(1)} → ${overall.last.toFixed(1)}${dir === "fragile" ? ` — but the window decides it, so it is not evidence of anything.` : "."}</p>
    <figure class="${dir}">
      ${hero(overall, runs)}
      <figcaption><span><span class="key raw"></span>overall score, per run &nbsp; <span class="key fit"></span>fitted trend</span><span>drift ${sign(overall.drift)} · sd ${overall.sd.toFixed(2)} · mean ${overall.mean.toFixed(1)}</span></figcaption>
      ${overall.windows && !overall.windowStable ? `<p class="fragile-note">A straight line is the wrong shape for this series. It steps up at <strong>${esc(overall.windows.length > 2 ? runs[2].version : runs[0].version)}</strong> and drifts after, so the fit reads ${overall.windows.map(w => `${sign(w.drift)} from ${esc(w.from)}`).slice(0, 3).join(", ")} — the window decides the answer. Only a verdict that holds from every start is counted below.</p>` : (dir === "fragile" ? `<p class="fragile-note">This line's verdict rests on <strong>${esc(overall.restsOn.join(" / "))}</strong>.</p>` : "")}
    </figure>
  </section>

  <section class="callout">
    <p class="q">“The error was comparing neighbours instead of fitting the series.”</p>
    <p>Found on 2026-09-17, by hand, in the prose of one run record. <strong>setup_and_docs</strong> went 85 → 89 → 92 across three runs and was reported repeatedly as the programme’s success. Fitted across all ${n} runs it is ${categories.setup_and_docs ? `${categories.setup_and_docs.first.toFixed(0)} → ${categories.setup_and_docs.last.toFixed(0)}` : "declining"} — a local recovery inside a falling line. This page exists so that fit is never done by hand again.</p>
  </section>

  <section>
    <h2>Every category, sorted by drift — ${falling.length} survive every cut</h2>
    <div class="grid-cards">${cards}</div>
  </section>

  <details>
    <summary>All scores, as a table</summary>
    <div class="tablewrap">
      <table>
        <thead><tr><th scope="col">category</th>${runs.map(r => `<th scope="col">${esc(r.version)}</th>`).join("")}<th scope="col">/run</th><th scope="col">drift</th><th scope="col">sd</th><th scope="col">fit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>

  <footer>
    <p>A category is called <strong>falling</strong> or <strong>rising</strong> only when two things hold: its drift across the series exceeds one standard deviation of that series — the bar the original correction set — <em>and</em> the verdict survives leaving any single run out. A verdict that flips when one run is removed is marked <strong>rests on one run</strong> and is not counted. Everything else reads flat. Nothing here says <em>why</em>; it says where to look.</p>
    <p>N = 1 per version. Calibration runs, read for shape — not a ranking, and not a magnitude claim about any backend.</p>
    <p>Regenerate with <code>node benchmarks/scripts/score-trend.mjs</code> after every calibration.</p>
  </footer>
</div>
<div id="tip" role="status"></div>

<script>
(function () {
  var runs = ${JSON.stringify(runs.map((r, i) => ({ v: r.version, d: r.date, s: categories.overall.series[i] })))};
  var hero = document.getElementById("hero"), tip = document.getElementById("tip");
  if (!hero || !tip) return;
  function show(e, i) {
    var r = runs[i];
    tip.textContent = r.v + "  ·  " + r.s + "  ·  " + r.d;
    tip.style.opacity = "1";
    var pad = 14;
    var x = Math.min(e.clientX + pad, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - pad) + "px";
  }
  hero.querySelectorAll(".hit").forEach(function (h) {
    var i = +h.dataset.i;
    h.addEventListener("mousemove", function (e) { show(e, i); });
    h.addEventListener("mouseenter", function (e) { show(e, i); });
  });
  hero.addEventListener("mouseleave", function () { tip.style.opacity = "0"; });
})();
</script>
`;
}
