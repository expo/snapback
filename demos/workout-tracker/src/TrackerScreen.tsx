import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Tracker, Workout, WorkoutSet } from "./model";
import "./style.css";

const suggestions = ["Squat", "Bench press", "Deadlift", "Overhead press", "Row", "Pull-up", "Run"];
const dateLabel = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value);
const volume = (sets: WorkoutSet[]) => sets.filter(set => set.completed).reduce((total, set) => total + set.reps * set.weightKgX10, 0) / 10;

export function TrackerScreen({ tracker }: { tracker: Tracker }) {
  const orderedWorkouts = [...tracker.workouts].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [exercise, setExercise] = useState("");
  const [reps, setReps] = useState("8");
  const [weight, setWeight] = useState("20.0");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (pendingSelection) {
      if (tracker.workouts.some(workout => workout.id === pendingSelection)) {
        setSelectedId(pendingSelection);
        setPendingSelection(null);
      }
      return;
    }
    if (!selectedId || !tracker.workouts.some(workout => workout.id === selectedId)) {
      setSelectedId(orderedWorkouts[0]?.id ?? null);
    }
  }, [selectedId, pendingSelection, tracker.workouts]);

  const selected = tracker.workouts.find(workout => workout.id === selectedId) ?? null;
  const selectedSets = useMemo(() => tracker.sets.filter(set => set.workoutId === selectedId).sort((a, b) => a.at - b.at), [tracker.sets, selectedId]);
  const completedWorkouts = tracker.workouts.filter(workout => workout.finishedAt !== null).length;
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try { await action(); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const start = (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (!clean) { setProblem("Give this workout a title."); return; }
    void run(async () => { const id = await tracker.createWorkout(clean); setTitle(""); if (id) setPendingSelection(id); });
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const clean = exercise.trim();
    const repCount = Number(reps), kilos = Number(weight);
    if (!clean || clean.length > 80 || !Number.isInteger(repCount) || repCount < 1 || repCount > 1000 || !Number.isFinite(kilos) || kilos < 0 || !Number.isInteger(kilos * 10)) {
      setProblem("Use an exercise name, 1–1000 whole reps, and kilograms to one decimal place.");
      return;
    }
    void run(async () => { await tracker.addSet(selected.id, clean, repCount, Math.round(kilos * 10)); setExercise(""); });
  };

  return <div className="shell">
    <header className="topbar"><div><span className="eyebrow">Workout log</span><h1>Train with intent.</h1><p>Plan a session, record each set, and see the work add up.</p></div><div className="connection"><strong>{tracker.backend}</strong><span>{tracker.status}</span></div></header>
    <section className="stats" aria-label="Workout totals"><div><span>Sessions</span><strong>{tracker.workouts.length}</strong></div><div><span>Finished</span><strong>{completedWorkouts}</strong></div><div><span>Completed volume</span><strong>{volume(tracker.sets).toLocaleString()} <small>kg</small></strong></div></section>
    {(problem || tracker.error) && <p className="error" role="alert">{problem || tracker.error}</p>}
    <div className="layout"><aside className="panel sidebar"><div className="panel-heading"><h2>Workouts</h2><span>{tracker.workouts.length}</span></div>
      <form onSubmit={start} className="start-form"><label htmlFor="workout-title">New workout</label><div className="inline"><input id="workout-title" value={title} maxLength={80} placeholder="e.g. Strength day" onChange={event => setTitle(event.target.value)} /><button disabled={busy}>Start</button></div></form>
      {tracker.loading ? <p className="muted">Loading workouts…</p> : tracker.workouts.length ? <ul className="workout-list">{orderedWorkouts.map(workout => <li key={workout.id}><WorkoutButton workout={workout} sets={tracker.sets.filter(set => set.workoutId === workout.id)} selected={workout.id === selectedId} select={() => setSelectedId(workout.id)} /></li>)}</ul> : <p className="empty">Start your first workout to build a history.</p>}
    </aside><main className="panel detail">{selected ? <><div className="detail-heading"><div><span className="eyebrow">{selected.finishedAt === null ? "In progress" : "Finished"}</span><h2>{selected.title}</h2><p>{dateLabel(selected.startedAt)}</p></div>{selected.finishedAt === null && <button className="secondary" disabled={busy} onClick={() => void run(() => tracker.finishWorkout(selected.id))}>Finish workout</button>}</div>
      <div className="session-stats"><span>{selectedSets.length} sets</span><span>{selectedSets.filter(set => set.completed).length} complete</span><span>{volume(selectedSets).toLocaleString()} kg volume</span></div>
      {selected.finishedAt === null && <form className="set-form" onSubmit={add}><h3>Add a set</h3><div className="set-fields"><label>Exercise<input list="exercises" value={exercise} maxLength={80} placeholder="Choose or type" onChange={event => setExercise(event.target.value)} /></label><datalist id="exercises">{suggestions.map(name => <option key={name} value={name} />)}</datalist><label>Reps<input type="number" min="1" max="1000" step="1" value={reps} onChange={event => setReps(event.target.value)} /></label><label>Weight (kg)<input type="number" min="0" step="0.1" value={weight} onChange={event => setWeight(event.target.value)} /></label><button disabled={busy}>Add set</button></div></form>}
      <div className="sets-heading"><h3>Sets</h3><span>{selectedSets.length ? "Tap a set to mark it complete" : "No sets yet"}</span></div>
      <ul className="set-list">{selectedSets.map(set => <li key={set.id} className={set.completed ? "done" : ""}><button className="check" aria-label={`${set.completed ? "Mark incomplete" : "Mark complete"}: ${set.exercise}`} aria-pressed={set.completed} disabled={busy} onClick={() => void run(() => tracker.setCompleted(set.id, !set.completed))}>{set.completed ? "✓" : ""}</button><div><strong>{set.exercise}</strong><span>{set.reps} reps · {(set.weightKgX10 / 10).toFixed(1)} kg</span></div><button className="remove" aria-label={`Remove ${set.exercise} set`} disabled={busy} onClick={() => void run(() => tracker.removeSet(set.id))}>Remove</button></li>)}</ul>
    </> : <div className="blank"><h2>Ready when you are.</h2><p>Start a workout or select one from your history.</p></div>}</main></div>
  </div>;
}

function WorkoutButton({ workout, sets, selected, select }: { workout: Workout; sets: WorkoutSet[]; selected: boolean; select(): void }) {
  return <button className="workout-button" aria-current={selected ? "true" : undefined} onClick={select}><strong>{workout.title}</strong><span>{dateLabel(workout.startedAt)}</span><small>{workout.finishedAt === null ? "In progress" : "Finished"} · {sets.length} sets · {volume(sets)} kg</small></button>;
}
