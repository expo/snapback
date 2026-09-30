import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// This comparison runs on a local, single-user deployment. No function here
// claims an account boundary; adding auth is separate product work.
export const snapshot = query({
  args: {},
  handler: async (ctx) => ({
    workouts: await ctx.db.query("workouts").withIndex("by_startedAt").order("desc").take(100),
    sets: await ctx.db.query("sets").withIndex("by_at").order("desc").take(1000),
  }),
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const clean = title.trim();
    if (!clean || clean.length > 80) throw new Error("Title must be 1–80 characters");
    return ctx.db.insert("workouts", { title: clean, startedAt: Date.now() });
  },
});

export const addSet = mutation({
  args: { workoutId: v.id("workouts"), exercise: v.string(), reps: v.number(), weightKgX10: v.number() },
  handler: async (ctx, args) => {
    const workout = await ctx.db.get(args.workoutId);
    if (!workout) throw new Error("Workout not found");
    const exercise = args.exercise.trim();
    if (!exercise || exercise.length > 80) throw new Error("Exercise must be 1–80 characters");
    if (!Number.isInteger(args.reps) || args.reps < 1 || args.reps > 1000 || !Number.isInteger(args.weightKgX10) || args.weightKgX10 < 0) throw new Error("Invalid set");
    return ctx.db.insert("sets", { workoutId: args.workoutId, exercise, reps: args.reps, weightKgX10: args.weightKgX10, completed: false, at: Date.now() });
  },
});

export const setCompleted = mutation({
  args: { setId: v.id("sets"), completed: v.boolean() },
  handler: async (ctx, { setId, completed }) => {
    if (!(await ctx.db.get(setId))) throw new Error("Set not found");
    await ctx.db.patch(setId, { completed });
  },
});

export const removeSet = mutation({
  args: { setId: v.id("sets") },
  handler: async (ctx, { setId }) => {
    if (!(await ctx.db.get(setId))) throw new Error("Set not found");
    await ctx.db.delete(setId);
  },
});

export const finish = mutation({
  args: { workoutId: v.id("workouts") },
  handler: async (ctx, { workoutId }) => {
    const workout = await ctx.db.get(workoutId);
    if (!workout) throw new Error("Workout not found");
    if (workout.finishedAt === undefined) await ctx.db.patch(workoutId, { finishedAt: Date.now() });
  },
});
