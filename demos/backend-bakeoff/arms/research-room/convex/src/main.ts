import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main>
    <p class="eyebrow">Convex · Research Room</p>
    <h1>Evidence, moving live.</h1>
    <p class="lede">A neutral shell for sources, semantic retrieval, streamed research progress, and cited answers.</p>
    <section aria-label="Research room">
      <aside>
        <h2>Sources</h2>
        <div class="source active">Research source 00 <span>quartz</span></div>
        <div class="source">Research source 03 <span>quartz</span></div>
        <div class="source">Uploaded fixture <span>64 KiB</span></div>
      </aside>
      <article>
        <div class="question">What do the frozen records say?</div>
        <ol>
          <li class="done">Retrieving sources</li>
          <li class="done">Ranking evidence</li>
          <li class="done">Synthesizing answer</li>
          <li class="done">Attaching citations</li>
        </ol>
        <div class="answer">The deterministic answer cites two authorized research records.</div>
      </article>
    </section>
  </main>
`;
