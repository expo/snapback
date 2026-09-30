export type Workout = {
  id: string;
  title: string;
  startedAt: number;
  finishedAt: number | null;
};

export type WorkoutSet = {
  id: string;
  workoutId: string;
  exercise: string;
  reps: number;
  weightKgX10: number;
  completed: boolean;
  at: number;
};

export type Tracker = {
  backend: string;
  status: string;
  loading: boolean;
  error: string | null;
  workouts: Workout[];
  sets: WorkoutSet[];
  createWorkout(title: string): Promise<string | undefined>;
  addSet(workoutId: string, exercise: string, reps: number, weightKgX10: number): Promise<void>;
  setCompleted(setId: string, completed: boolean): Promise<void>;
  removeSet(setId: string): Promise<void>;
  finishWorkout(workoutId: string): Promise<void>;
};
