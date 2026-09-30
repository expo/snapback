import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { TrackerScreen } from "../TrackerScreen";
import type { Tracker, Workout, WorkoutSet } from "../model";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const client = url && key ? createClient(url, key) : null;

export function SupabaseApp() {
  if (!client) return <p role="alert">Start the local Supabase stack and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>;
  return <Connected />;
}

function Connected() {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [sets, setSets] = useState<WorkoutSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Connecting");

  useEffect(() => {
    if (!client) return;
    let active = true;
    const load = async () => {
      const [workoutResult, setResult] = await Promise.all([
        client.from("workouts").select("id,title,started_at,finished_at").order("started_at", { ascending: false }).limit(100),
        client.from("workout_sets").select("id,workout_id,exercise,reps,weight_kg_x10,completed,at").order("at", { ascending: false }).limit(1000),
      ]);
      if (!active) return;
      if (workoutResult.error || setResult.error) { setError((workoutResult.error ?? setResult.error)?.message ?? "Read failed"); setLoading(false); return; }
      setWorkouts((workoutResult.data ?? []).map(row => ({ id: row.id, title: row.title, startedAt: Date.parse(row.started_at), finishedAt: row.finished_at ? Date.parse(row.finished_at) : null })));
      setSets((setResult.data ?? []).map(row => ({ id: row.id, workoutId: row.workout_id, exercise: row.exercise, reps: row.reps, weightKgX10: row.weight_kg_x10, completed: row.completed, at: Date.parse(row.at) })));
      setError(null); setLoading(false);
    };
    void load();
    const channel = client.channel("workout-tracker")
      .on("postgres_changes", { event: "*", schema: "public", table: "workouts" }, () => { void load(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "workout_sets" }, () => { void load(); })
      .subscribe(state => setStatus(state === "SUBSCRIBED" ? "Live" : state === "CHANNEL_ERROR" ? "Realtime unavailable" : "Connecting"));
    return () => { active = false; void client.removeChannel(channel); };
  }, []);

  const refresh = async () => {
    if (!client) return;
    const [workoutResult, setResult] = await Promise.all([
      client.from("workouts").select("id,title,started_at,finished_at").order("started_at", { ascending: false }).limit(100),
      client.from("workout_sets").select("id,workout_id,exercise,reps,weight_kg_x10,completed,at").order("at", { ascending: false }).limit(1000),
    ]);
    if (workoutResult.error || setResult.error) throw workoutResult.error ?? setResult.error;
    setWorkouts((workoutResult.data ?? []).map(row => ({ id: row.id, title: row.title, startedAt: Date.parse(row.started_at), finishedAt: row.finished_at ? Date.parse(row.finished_at) : null })));
    setSets((setResult.data ?? []).map(row => ({ id: row.id, workoutId: row.workout_id, exercise: row.exercise, reps: row.reps, weightKgX10: row.weight_kg_x10, completed: row.completed, at: Date.parse(row.at) })));
  };
  const required = () => { if (!client) throw new Error("Supabase is not configured"); return client; };
  const tracker: Tracker = {
    backend: "Supabase",
    status,
    loading,
    error,
    workouts,
    sets,
    createWorkout: async title => { const { data, error } = await required().from("workouts").insert({ title }).select("id").single(); if (error) throw error; await refresh(); return data.id; },
    addSet: async (workoutId, exercise, reps, weightKgX10) => { const { error } = await required().from("workout_sets").insert({ workout_id: workoutId, exercise, reps, weight_kg_x10: weightKgX10 }); if (error) throw error; await refresh(); },
    setCompleted: async (setId, completed) => { const { error } = await required().from("workout_sets").update({ completed }).eq("id", setId); if (error) throw error; await refresh(); },
    removeSet: async setId => { const { error } = await required().from("workout_sets").delete().eq("id", setId); if (error) throw error; await refresh(); },
    finishWorkout: async workoutId => { const { error } = await required().from("workouts").update({ finished_at: new Date().toISOString() }).eq("id", workoutId); if (error) throw error; await refresh(); },
  };
  return <TrackerScreen tracker={tracker} />;
}
