import { useApi } from "../api";
import { ago, duration, fromNow, Status, when } from "../format";
import type { Run } from "../gen/moksha/v1/run_pb";
import { usePoll } from "../hooks";
import { usePipelines } from "../pipelines";
import { Link, type PipelineTab } from "../router";
import { Hint } from "../words";
import { Dag } from "./Dag";
import { PipelineRuns } from "./PipelineRuns";
import { PipelineWorkers } from "./PipelineWorkers";
import { Crumbs } from "./Crumbs";
import { StartRun, summary } from "./RunList";

const TABS: { tab: PipelineTab; label: string }[] = [
  { tab: "runs", label: "Runs" },
  { tab: "steps", label: "Steps" },
  { tab: "workers", label: "Workers" },
  { tab: "start", label: "Start a run" },
];

// Pipeline: one pipeline (a run by name): what it is and how it is started,
// then a tab each for its runs (by day and hour), its steps as a graph, the
// workers that worked on it, and starting a run. Each tab asks only for
// what it shows, and has its own URL.
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
      <Crumbs items={[...pipelines.trail(run), { label: pipelines.title(run) }]} />
      <div className="page-head">
        <h1>{pipelines.title(run)}</h1>
        {s && <Status status={s.last.status} />}
      </div>
      {info?.description && <p className="lede">{info.description}</p>}
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
        {tab === "runs" && <PipelineRuns run={run} />}
        {tab === "steps" && <Steps latest={latest} loaded={!!all.data} now={now} />}
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

// Steps: the pipeline's steps as a graph, from its newest run (pipeline
// code decides its steps as it runs), and which data each one writes.
function Steps({ latest, loaded, now }: { latest?: Run; loaded: boolean; now: number }) {
  const api = useApi();
  const graph = usePoll(() => (latest ? api.runs.getRun({ runId: latest.id }) : Promise.resolve(undefined)), [latest?.id]);
  const steps = graph.data?.run?.steps ?? [];
  if (graph.error) return <p className="error">{graph.error}</p>;
  if (!steps.length) return <p className="dim">{loaded && (!latest || graph.data) ? "no run has steps yet" : "loading…"}</p>;
  return (
    <>
      <h2>
        Steps <Hint word="step" />
      </h2>
      <Dag steps={steps} now={now} plain />
      <p className="dim small">
        as in the <Link to={{ name: "run", id: latest!.id }}>latest run</Link>, {ago(latest!.createdAt, now)}
      </p>
    </>
  );
}
