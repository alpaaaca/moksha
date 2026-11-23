import { useApi } from "./api";
import type { Run } from "./gen/moksha/v1/run_pb";
import { POLL_MS, usePoll } from "./hooks";

const HISTORY = 500;
const CONTINUE = "continue ";

// A chain is a loop as it goes on through continue_as_new, told as one: the
// run it is in now, the first one known, and how many. whole: first is
// where it started, not just the oldest run loaded.
export type Chain = { now: Run; first: Run; runs: number; whole: boolean };

// chain follows a run back through the runs it continued from.
export function chain(now: Run, byId: Map<string, Run>): Chain {
  let first = now;
  let runs = 1;
  while (first.trigger.startsWith(CONTINUE)) {
    const before = byId.get(first.trigger.slice(CONTINUE.length));
    if (!before) return { now, first, runs, whole: false };
    first = before;
    runs++;
  }
  return { now, first, runs, whole: true };
}

export type Loop = { name: string; live: Chain[]; last?: Run };

// useLoopRuns loads the loops' runs: the open ones, however old, and the newest.
export function useLoopRuns(every = POLL_MS) {
  const api = useApi();
  const res = usePoll(
    () =>
      Promise.all([
        api.runs.listRuns({ kind: "loop", statuses: ["running", "stuck"], limit: 1000 }),
        api.runs.listRuns({ kind: "loop", limit: HISTORY }),
      ]).then(([open, newest]) => ({ open: open.runs, newest: newest.runs })),
    [],
    every,
  );
  function loops(names: string[]): Loop[] {
    const { open = [], newest = [] } = res.data ?? {};
    const byId = new Map([...newest, ...open].map((h) => [h.id, h]));
    return names.map((name) => ({
      name,
      live: open.filter((h) => h.name === name).map((h) => chain(h, byId)),
      last: newest.find((h) => h.name === name),
    }));
  }
  return { loaded: !!res.data, loops, error: res.error, reload: res.reload };
}

// broken: a loop someone should look at, stuck or ended by a failure.
export function broken(l: Loop): boolean {
  if (l.live.length) return l.live.some((c) => c.now.status === "stuck");
  return l.last?.status === "failed";
}
