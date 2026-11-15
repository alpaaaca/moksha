import { useState } from "react";

import { useApi } from "../api";
import { ago, duration, fromNow, Status, when } from "../format";
import type { Run } from "../gen/moksha/v1/run_pb";
import { usePoll } from "../hooks";
import { usePipelines } from "../pipelines";
import { Link, type PipelineTab } from "../router";
import { Hint } from "../words";
import { Dag } from "./Dag";
import { PipelineWorkers } from "./PipelineWorkers";
import { RunHistory } from "./RunHistory";
import { RunsTable, StartRun, StatusFilter, summary } from "./RunList";

const HISTORY = 30;

const TABS: { tab: PipelineTab; label: string }[] = [
  { tab: "overview", label: "Overview" },
  { tab: "runs", label: "Runs" },
  { tab: "workers", label: "Workers" },
  { tab: "start", label: "Start a run" },
];

// Pipeline: one pipeline (a run by name): what it is and how it is started,
// then a tab each for its recent runs by step and its steps as a graph
// (Overview), all its runs, the workers that worked on it, and starting a
// run. Each tab asks only for what it shows, and has its own URL.
export function Pipeline({ run, tab }: { run: string; tab: PipelineTab }) {
  const api = useApi();
  const pipelines = usePipelines();
  const all = usePoll(() => api.runs.listRuns({ name: run, limit: 500 }), [run]);
  const latest = all.data?.runs[0];
  const info = pipelines.info(run);
  const s = all.data && all.data.runs.length ? summary(all.data.runs) : undefined;
  const schedule = pipelines.schedule(run);
  const sub = pipelines.subscription(run);
  const now = Date.now();

  return (
    <section>
      <p>
        <Link to={{ name: "runs" }}>← all pipelines</Link>
      </p>
      <div className="toolbar">
        <h1>{pipelines.title(run)}</h1>
        {s && <Status status={s.last.status} />}
      </div>
      {info?.description && <p className="desc">{info.description}</p>}
      <dl className="facts meta">
        <dt>in code</dt>
        <dd className="mono">{run}</dd>
        <dt>runs</dt>
        <dd>
          {schedule ? (
            <>
              on a schedule: <span className="mono">{schedule.cron}</span>
              {` (${schedule.timezone || "UTC"})`}, {schedule.interval} data, catch-up {schedule.catchUp || "latest"}
            </>
          ) : sub ? (
            <>
              when new data arrives in <span className="mono">{sub.datasets.join(", ")}</span>
              {sub.waiting > 0 && ` (${sub.waiting} waiting)`}
            </>
          ) : (
            "when started (from here, moksha start, or another pipeline)"
          )}
        </dd>
        {schedule && (
          <>
            <dt>next run</dt>
            <dd>
              {fromNow(schedule.nextRun, now)} <span className="dim">({when(schedule.nextRun)})</span>
            </dd>
          </>
        )}
        {s && (
          <>
            <dt>history</dt>
            <dd>
              {all.data!.runs.length} runs, last {ago(s.last.createdAt, now)}
              {s.usually !== undefined && `, usually ${duration(s.usually)}`}
              {s.failed > 0 && <span className="error">, {s.failed} failed</span>}
            </dd>
          </>
        )}
      </dl>

      <nav className="tabs" role="tablist" aria-label="pipeline">
        {TABS.map((t) => (
          <Link
            key={t.tab}
            to={{ name: "pipeline", run, tab: t.tab }}
            role="tab"
            selected={t.tab === tab}
            className={t.tab === tab ? "tab active" : "tab"}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div role="tabpanel" aria-label={TABS.find((t) => t.tab === tab)!.label}>
        {tab === "overview" && <Overview run={run} latest={latest} loaded={!!all.data} now={now} />}
        {tab === "runs" && <AllRuns run={run} />}
        {tab === "workers" && <PipelineWorkers run={run} />}
        {tab === "start" && (
          <>
            {/* A scheduled pipeline takes its data interval as an input: start with the latest one. */}
            <StartRun run={run} inputs={schedule?.latestParamsJson || latest?.paramsJson || "{}"} />
            {schedule?.latestParamsJson && <p className="dim small">inputs of the latest interval that came due</p>}
          </>
        )}
      </div>
    </section>
  );
}

// Overview: the recent runs by step, and the steps as a graph (from the
// newest run: pipeline code decides its steps as it runs).
function Overview({ run, latest, loaded, now }: { run: string; latest?: Run; loaded: boolean; now: number }) {
  const api = useApi();
  const history = usePoll(() => api.runs.listRuns({ name: run, limit: HISTORY, withSteps: true }), [run]);
  const graph = usePoll(() => (latest ? api.runs.getRun({ runId: latest.id }) : Promise.resolve(undefined)), [latest?.id]);
  const steps = graph.data?.run?.steps ?? [];
  return (
    <>
      <h2>Recent runs</h2>
      {history.data && history.data.runs.length > 0 ? (
        <RunHistory runs={history.data.runs} now={now} />
      ) : (
        <p className="dim">{history.data ? "no runs yet" : "loading…"}</p>
      )}

      <h2>
        Steps <Hint word="step" />
      </h2>
      {steps.length > 0 ? (
        <>
          <Dag steps={steps} now={now} plain />
          <p className="dim small">as in the latest run</p>
        </>
      ) : (
        <p className="dim">{loaded ? "no run has steps yet" : "loading…"}</p>
      )}
    </>
  );
}

function AllRuns({ run }: { run: string }) {
  const api = useApi();
  const [status, setStatus] = useState("");
  const runs = usePoll(() => api.runs.listRuns({ name: run, statuses: status ? [status] : [], limit: 100 }), [run, status]);
  return (
    <>
      <div className="toolbar">
        <StatusFilter value={status} onChange={setStatus} />
      </div>
      {runs.error && <p className="error">{runs.error}</p>}
      {runs.data ? <RunsTable runs={runs.data.runs} /> : !runs.error && <p className="dim">loading…</p>}
    </>
  );
}
