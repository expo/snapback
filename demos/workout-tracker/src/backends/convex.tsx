import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { TrackerScreen } from "../TrackerScreen";
import type { Tracker } from "../model";

const url = import.meta.env.VITE_CONVEX_URL;
const client = url ? new ConvexReactClient(url) : null;

export function ConvexApp() {
  if (!client) return <p role="alert">Start the local Convex deployment and set VITE_CONVEX_URL.</p>;
  return <ConvexProvider client={client}><Connected /></ConvexProvider>;
}

function Connected() {
  const snapshot = useQuery(api.workouts.snapshot, {});
  const create = useMutation(api.workouts.create);
  const addSet = useMutation(api.workouts.addSet);
  const setCompleted = useMutation(api.workouts.setCompleted);
  const removeSet = useMutation(api.workouts.removeSet);
  const finish = useMutation(api.workouts.finish);
  const tracker: Tracker = {
    backend: "Convex",
    status: snapshot === undefined ? "Connecting" : "Live",
    loading: snapshot === undefined,
    error: null,
    workouts: (snapshot?.workouts ?? []).map(row => ({ id: row._id, title: row.title, startedAt: row.startedAt, finishedAt: row.finishedAt ?? null })),
    sets: (snapshot?.sets ?? []).map(row => ({ id: row._id, workoutId: row.workoutId, exercise: row.exercise, reps: row.reps, weightKgX10: row.weightKgX10, completed: row.completed, at: row.at })),
    createWorkout: async title => create({ title }),
    addSet: async (workoutId, exercise, reps, weightKgX10) => { await addSet({ workoutId: workoutId as Id<"workouts">, exercise, reps, weightKgX10 }); },
    setCompleted: async (setId, completed) => { await setCompleted({ setId: setId as Id<"sets">, completed }); },
    removeSet: async setId => { await removeSet({ setId: setId as Id<"sets"> }); },
    finishWorkout: async workoutId => { await finish({ workoutId: workoutId as Id<"workouts"> }); },
  };
  return <TrackerScreen tracker={tracker} />;
}
