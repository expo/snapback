import { useEffect, useState } from "react";
import { supabase } from "./supabase";

type Preview = {
  id: string;
  title: string;
  summary: string;
  venue_public: string;
  starts_at: string;
  art_path: string | null;
};

export function PartifulApp() {
  const [event, setEvent] = useState<Preview | null>(null);
  const [status, setStatus] = useState("Loading public preview…");

  useEffect(() => {
    void supabase.from("public_event_previews")
      .select("id,title,summary,venue_public,starts_at,art_path")
      .eq("slug", "summer-rooftop").single()
      .then(({ data, error }) => {
        if (error) setStatus(error.message);
        else {
          setEvent(data);
          setStatus("Public preview · private controls protected");
        }
      });
  }, []);

  return (
    <main>
      <header><span className="eyebrow">PARTY / SUPABASE</span><span className="status">{status}</span></header>
      <section className="hero">
        <div className="date"><strong>15</strong><span>AUG</span></div>
        <div>
          <p className="kicker">You’re invited</p>
          <h1>{event?.title ?? "Summer Rooftop"}</h1>
          <p className="summary">{event?.summary ?? "Loading the event…"}</p>
          <p className="place">{event?.venue_public ?? "San Francisco"}</p>
        </div>
      </section>
      <section className="cards">
        <article><small>RSVP</small><h2>Yes, no, or maybe</h2><p>Invitations, plus-ones, and capacity settle authoritatively.</p></article>
        <article><small>LIVE WALL</small><h2>Plans in motion</h2><p>Guests receive posts and totals over native Postgres Changes.</p></article>
        <article className="locked"><small>HOST SPACE</small><h2>Private controls</h2><p>Sign in as a host or cohost to edit details, reminders, and art.</p></article>
      </section>
    </main>
  );
}
