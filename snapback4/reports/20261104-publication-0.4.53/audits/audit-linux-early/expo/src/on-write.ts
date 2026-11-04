import { refusalOf, type Write } from "snapback4/contract";

// Accept SDK results directly, including MutationPromise and nullable rows.
// Pending is queued, sent is committed; only sent is a successful server write.
export async function onWrite<R>(run: () => PromiseLike<Write<R>>, setProblem: (message: string) => void): Promise<Write<R> | undefined> {
  setProblem("");
  try {
    const write = await run();
    setProblem(refusalOf(write)?.message ?? "");
    return write;
  } catch {
    setProblem("Write did not finish; inspect its receipt before retrying.");
    return undefined;
  }
}

