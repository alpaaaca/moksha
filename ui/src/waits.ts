import { useApi } from "./api";
import type { Run, SignalWait } from "./gen/moksha/v1/run_pb";
import { ms } from "./format";
import { POLL_MS, usePoll } from "./hooks";

// parked: a run in progress with nothing to do until a signal comes. One
// whose other steps still run is at work, though it waits too.
export function parked(h: Run): boolean {
  if (h.status !== "running" || h.signalWaits.length === 0) return false;
  const c = h.stepCounts;
  return !c || c.completed + c.failed + c.cancelled >= c.total;
}

export type Wait = { run: Run; wait: SignalWait };

// useSignalWaits loads what pipelines' runs wait for from outside, soonest
// to time out first. What loops listen for is on the Loops page.
export function useSignalWaits(every = POLL_MS) {
  const api = useApi();
  const res = usePoll(() => api.runs.listRuns({ kind: "pipeline", statuses: ["running"], limit: 1000 }), [], every);
  const until = (w: Wait) => ms(w.wait.timesOutAt) ?? Number.MAX_SAFE_INTEGER;
  const waits = res.data?.runs.flatMap((run) => run.signalWaits.map((wait) => ({ run, wait }))).sort((a, b) => until(a) - until(b));
  return { waits, error: res.error, reload: res.reload };
}
