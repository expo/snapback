import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const stages = ["Reading 20 sources", "Keyword retrieval", "Building citations", "Answer complete"];

function App() {
  return <main>
    <header><span className="mark">IR</span><div><h1>Research room</h1><p>InstantDB · live collaborative evidence</p></div><span className="live">● LIVE</span></header>
    <section className="grid">
      <aside><h2>Climate adaptation</h2><p className="muted">2 members · 20 sources</p><div className="people"><b>A</b><b>B</b><span>Alice and Bob</span></div><h3>Sources</h3>{[1,5,9,13,17].map(n => <article key={n}>Source {String(n).padStart(2,"0")}<small>climate evidence · 64 KiB</small></article>)}</aside>
      <section className="answer"><label>Question</label><h2>What evidence connects urban heat and climate adaptation?</h2><div className="progress">{stages.map((s,i)=><div key={s}><i>{i+1}</i><span>{s}</span><em>{i===3?"complete":"durable"}</em></div>)}</div><div className="result"><h3>Synthesized answer</h3><p>The room’s evidence identifies recurring mitigation patterns across the expected source set.</p><span>[Source 01]</span> <span>[Source 05]</span> <span>[Source 09]</span></div></section>
      <aside className="activity"><h3>Live activity</h3><p><b>Alice</b> asked a question</p><p><b>Bob</b> observed progress #4</p><p className="secure">Room membership enforced</p></aside>
    </section>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
