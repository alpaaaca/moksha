import type { Duration } from "@bufbuild/protobuf/wkt";

import { useApi } from "../api";
import { ago, duration, when } from "../format";
import { usePoll } from "../hooks";

export const WORKER_RUNS = 100;

function millis(d?: Duration): number | undefined {
  return d ? Number(d.seconds) * 1000 + d.nanos / 1e6 : undefined;
}

// PipelineWorkers: which workers worked on a pipeline's newest runs and what
// they did, from the stored step attempts and replays (so also workers that
// are gone), and whether each is connected now.
export function PipelineWorkers({ run }: { run: string }) {
  const api = useApi();
  const stats = usePoll(() => api.runs.getPipelineWorkers({ name: run, runs: WORKER_RUNS }), [run]);
  const live = usePoll(() => api.runs.listWorkers({}), []);
  if (stats.error) return <p className="error">{stats.error}</p>;
  const ws = stats.data?.workers;
  if (!ws) return <p className="dim">loading…</p>;
  if (ws.length === 0) return <p className="dim">no worker has worked on it yet</p>;
  const connected = new Set((live.data?.workers ?? []).map((w) => w.id));
  const now = ws.filter((w) => connected.has(w.workerId)).length;
  const steps = ws.reduce((n, w) => n + w.steps, 0);
  return (
    <>
      <p className="small">
        {ws.length} {ws.length === 1 ? "worker" : "workers"} worked on its last {WORKER_RUNS} runs ({steps} step{" "}
        {steps === 1 ? "attempt" : "attempts"}); {now} connected now.
      </p>
      <table className="small" aria-label="pipeline workers">
        <thead>
          <tr>
            <th>worker</th>
            <th>runs</th>
            <th>steps</th>
            <th>replays</th>
            <th>step time</th>
            <th>last work</th>
            <th>now</th>
          </tr>
        </thead>
        <tbody>
          {ws.map((w) => {
            const median = millis(w.stepMedian);
            const p95 = millis(w.stepP95);
            return (
              <tr key={w.workerId}>
                <td className="mono">{w.workerId}</td>
                <td>{w.runs}</td>
                <td>
                  {w.steps}
                  {w.steps > 0 && ` (${w.stepsSucceeded} succeeded`}
                  {w.stepsFailed > 0 && <span className="error">, {w.stepsFailed} failed</span>}
                  {w.stepsLost > 0 && <span className="error">, {w.stepsLost} lost</span>}
                  {w.stepsCancelled > 0 && `, ${w.stepsCancelled} cancelled`}
                  {w.steps > 0 && ")"}
                </td>
                <td>
                  {w.replays}
                  {w.replaysFailed > 0 && <span className="error"> ({w.replaysFailed} failed)</span>}
                </td>
                <td>{median === undefined ? "–" : `${duration(median)} median, ${duration(p95!)} p95`}</td>
                <td title={when(w.lastAt)}>{ago(w.lastAt)}</td>
                <td>{connected.has(w.workerId) ? "connected" : <span className="dim">gone</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dim small">A pool's workers keep their ID when restarted; a worker run by hand gets a new one each start. Reused steps took no worker.</p>
    </>
  );
}
