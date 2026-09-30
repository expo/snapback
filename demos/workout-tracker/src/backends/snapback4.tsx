import { useEffect, useState } from "react";
import { isReady } from "snapback4/contract";
import { AppProvider, useAcquired, useAuth, useClient, useLink, useQuery } from "snapback4/react";
import { api } from "../../snapback/generated/api";
import { app } from "../client";
import { TrackerScreen } from "../TrackerScreen";
import type { Tracker } from "../model";

const noArgs = {};
export function SnapbackApp() { return <AppProvider app={app}><Account /></AppProvider>; }

function Account() {
  const auth = useAuth();
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (auth.state !== "signed-out") return;
    void auth.guest().then(result => { if (!result.ok) setProblem(result.why.message); }).catch(error => setProblem(String(error)));
  }, [auth.state]);
  if (auth.state === "signed-in") return <Connected />;
  return <p role={problem ? "alert" : "status"}>{problem ?? "Opening local guest account…"}</p>;
}

function Connected() {
  const client = useClient();
  const workoutsRead = useQuery(api.myWorkouts, noArgs);
  const setsRead = useQuery(api.mySets, noArgs);
  const link = useLink();
  const acquired = useAcquired();
  const [note, setNote] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // @ref LLP 3000#2-the-bet-on-one-page — a pending local write is not a server receipt.
  useEffect(() => {
    if (!pendingId) return;
    let active = true;
    const settled = (write: { id: string; state: string; why?: { message: string } }) => {
      if (!active || write.id !== pendingId || write.state === "pending") return;
      setPendingId(null);
      if (write.state === "failed") setNote(write.why?.message ?? "Write failed");
    };
    const unsubscribe = client.onWrite(settled);
    void client.write(pendingId).then(write => { if (write) settled(write); });
    return () => { active = false; unsubscribe(); };
  }, [client, pendingId]);
  const send = async <A, R>(op: { kind: "mutation"; name: string }, args: A): Promise<R | undefined> => {
    // The SDK owns the durable write id and outbox; pending means accepted for replay.
    const outcome = await client.mutate(op as never, args as never, { waitSeconds: 5 });
    if (outcome.state === "failed") throw new Error(outcome.why.message);
    if (outcome.state === "pending") { setNote(null); setPendingId(outcome.id); return undefined; }
    setPendingId(null);
    setNote(null);
    return outcome.replayed ? undefined : outcome.result as R;
  };
  const tracker: Tracker = {
    backend: "Snapback 4 · 0.4.9",
    status: note ?? (pendingId ? "Write queued; waiting for the backend" : `${link === "online" ? "Live" : "Offline"}${acquired ? " · local copy ready" : " · acquiring"}`),
    loading: !isReady(workoutsRead) || !isReady(setsRead),
    error: "denied" in workoutsRead ? workoutsRead.denied.message : "denied" in setsRead ? setsRead.denied.message : null,
    workouts: isReady(workoutsRead) ? workoutsRead.data.map(row => ({ id: row.id, title: row.title, startedAt: row.startedAt, finishedAt: row.finishedAt })) : [],
    sets: isReady(setsRead) ? setsRead.data.map(row => ({ id: row.id, workoutId: row.workoutId, exercise: row.exercise, reps: row.reps, weightKgX10: row.weightKgX10, completed: row.completed, at: row.at })) : [],
    createWorkout: async title => (await send<{ title: string }, { id: string }>(api.createWorkout, { title }))?.id,
    addSet: async (workoutId, exercise, reps, weightKgX10) => { await send(api.addSet, { workoutId, exercise, reps, weightKgX10 }); },
    setCompleted: async (setId, completed) => { await send(api.setCompleted, { setId, completed }); },
    removeSet: async setId => { await send(api.removeSet, { setId }); },
    finishWorkout: async workoutId => { await send(api.finishWorkout, { workoutId }); },
  };
  return <TrackerScreen tracker={tracker} />;
}
