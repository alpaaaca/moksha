import { useState, type FormEvent } from "react";

import { useApi } from "../api";
import type { Run } from "../gen/moksha/v1/run_pb";
import { ago, duration, fromNow, ms, RUN_STATUSES, Status, steps, took, Values, when } from "../format";
import { message, usePoll } from "../hooks";
import { groupLabel, usePipelines, type Pipelines } from "../pipelines";
import { Link, navigate } from "../router";
import { parked } from "../waits";
import { Icon } from "../icons";
import { Hint } from "../words";
import { isMac } from "../App";
import { Crumbs } from "./Crumbs";
import { JsonEditor, jsonError, pretty } from "./JsonEditor";
import { Waiting } from "./Waiting";

const OVERVIEW = 500;

// useOverview is the newest runs of pipelines that end, by pipeline (newest
// first), with every pipeline listed even if it never ran; ready once both
// lists have loaded (else a loop would flash up as a pipeline).
export function useOverview(pipelines: Pipelines) {
  const api = useApi();
  const overview = usePoll(() => api.runs.listRuns({ kind: "pipeline", limit: OVERVIEW }), []);
  const byName = new Map<string, Run[]>();
  for (const name of pipelines.names) byName.set(name, []);
  for (const h of overview.data?.runs ?? []) byName.set(h.name, [...(byName.get(h.name) ?? []), h]);
  const names = [...byName.keys()].filter((name) => !pipelines.info(name)?.loops).sort((a, b) => pipelines.title(a).localeCompare(pipelines.title(b)));
  return { overview, byName, names, ready: !!overview.data && pipelines.loaded };
}

// RunList is a group's Pipelines page: the pipelines that end (runs by
// name) and what to know about each: what it is, how it is started, how its
// recent runs went. Loops and runs parked on a signal have pages of their
// own. Their runs are on each pipeline's page.
export function RunList({ group }: { group: string }) {
  const pipelines = usePipelines();
  const { overview, byName, names: all, ready } = useOverview(pipelines);
  const names = all.filter((n) => pipelines.group(n) === group);
  const runs = (overview.data?.runs ?? []).filter((h) => !parked(h) && names.includes(h.name));

  return (
    <section>
      <GroupHead group={group} page="Pipelines" pipelines={pipelines} />
      <p className="lede">The group's pipelines, how they start, and how their runs went.</p>
      {ready && <Stats pipelines={names.length} runs={runs} />}
      {overview.error && <p className="error">{overview.error}</p>}
      {ready && names.length === 0 && (
        <p className="empty">No pipelines that end in this group: it may only have loops, or none registered now.</p>
      )}
      {ready && names.length > 0 && <PipelinesTable names={names} byName={byName} pipelines={pipelines} />}
      {overview.data && overview.data.runs.length === OVERVIEW && (
        <p className="dim small">counted over the newest {OVERVIEW} runs</p>
      )}
    </section>
  );
}

// GroupHead is the top of a group's pages: where it is, its name, and the
// projects that deployed its pipelines (which version, when).
export function GroupHead({ group, page, pipelines }: { group: string; page: string; pipelines: Pipelines }) {
  const deployments = pipelines.groups.find((g) => g.name === group)?.deployments ?? [];
  return (
    <>
      <Crumbs items={[{ label: "Groups", to: { name: "home" } }, { label: groupLabel(group), to: { name: "runs", group } }, { label: page }]} />
      <div className="page-head">
        <h1>{page}</h1>
        <span className="group-tag">
          <Icon name="group" size={13} />
          {groupLabel(group)}
        </span>
        {deployments.map((d) => (
          <span key={d.project} className="dim small" title={`build ${d.buildId}${d.by ? `, deployed by ${d.by}` : ""}, ${when(d.deployedAt)}`}>
            project {d.project} v{d.version} · deployed {ago(d.deployedAt)}
          </span>
        ))}
      </div>
    </>
  );
}

function Stats({ pipelines, runs }: { pipelines: number; runs: Run[] }) {
  const day = Date.now() - 86400000;
  const today = runs.filter((h) => (ms(h.createdAt) ?? 0) >= day);
  const running = runs.filter((h) => h.status === "running").length;
  const failed = today.filter((h) => h.status === "failed" || h.status === "stuck").length;
  return (
    <dl className="stats">
      <div>
        <dt>pipelines</dt>
        <dd>{pipelines}</dd>
      </div>
      <div>
        <dt>runs, last 24 h</dt>
        <dd>{today.length}</dd>
      </div>
      <div>
        <dt>running now</dt>
        <dd className={running ? "run" : ""}>{running}</dd>
      </div>
      <div>
        <dt>failed, last 24 h</dt>
        <dd className={failed ? "bad" : ""}>{failed}</dd>
      </div>
    </dl>
  );
}

// PipelinesTable lists pipelines, by title.
function PipelinesTable({ names, byName, pipelines }: { names: string[]; byName: Map<string, Run[]>; pipelines: Pipelines }) {
  return (
    <table className="pipelines">
      <thead>
        <tr>
          <th>
            pipeline <Hint word="pipeline" />
          </th>
          <th>
            schedule <Hint word="schedule" />
          </th>
          <th>next run</th>
          <th>
            recent runs <Hint word="run" />
          </th>
          <th>last run</th>
          <th>succeeded</th>
          <th>usually takes</th>
        </tr>
      </thead>
      <tbody>
        {names.map((name) => (
          <PipelineRow key={name} name={name} runs={byName.get(name)!} pipelines={pipelines} />
        ))}
      </tbody>
    </table>
  );
}

export const failing = (runs: Run[]) => {
  const last = runs.find((h) => !parked(h) && h.finishedAt);
  return last?.status === "failed" || last?.status === "stuck";
};

// Recent is a strip of runs, oldest to newest, each as tall as it took.
export function Recent({ runs, label, pipelines }: { runs: Run[]; label: string; pipelines?: Pipelines }) {
  const recent = [...runs.slice(0, RECENT)].reverse();
  const longest = Math.max(...recent.map((h) => took(h.createdAt, h.finishedAt) ?? 0), 1);
  return (
    <span className="recent" aria-label={label}>
      {recent.map((h) => (
        <Link
          key={h.id}
          to={{ name: "run", id: h.id }}
          className={`recent-run run-${h.status}`}
          label={`${pipelines ? pipelines.title(h.name) + ": " : ""}${h.status}, started ${ago(h.createdAt)}`}
          onClick={(e) => e.stopPropagation()}
        >
          <span style={{ height: `${Math.max(((took(h.createdAt, h.finishedAt) ?? 0) / longest) * 100, 18)}%` }} />
        </Link>
      ))}
    </span>
  );
}

const RECENT = 12;

function PipelineRow({ name, runs: all, pipelines }: { name: string; runs: Run[]; pipelines: Pipelines }) {
  const runs = all.filter((h) => !parked(h));
  const info = pipelines.info(name);
  const schedule = pipelines.schedule(name);
  const sub = pipelines.subscription(name);
  const s = runs.length ? summary(runs) : undefined;
  const finished = runs.filter((h) => h.finishedAt);
  const ok = finished.filter((h) => h.status === "completed" || h.status === "continued").length;
  return (
    // One line, like a group's: the description is its title here, and on its page.
    <tr className="clickable" onClick={() => navigate({ name: "pipeline", run: name })} title={info?.description || undefined}>
      <td>
        <Link to={{ name: "pipeline", run: name }} className="strong" onClick={(e) => e.stopPropagation()}>
          {pipelines.title(name)}
        </Link>
        {info?.title && <span className="mono dim small"> {name}</span>}
      </td>
      <td className="small">
        {schedule ? (
          <span title={`${schedule.interval} data`}>
            <span className="mono">{schedule.cron}</span> <span className="dim">{schedule.timezone || "UTC"}</span>
          </span>
        ) : sub ? (
          <span className="dim" title={`when new data arrives in ${sub.datasets.join(", ")}`}>
            on new data: <span className="mono">{sub.datasets.join(", ")}</span>
          </span>
        ) : (
          <span className="dim">on demand</span>
        )}
      </td>
      <td className="small" title={schedule ? when(schedule.nextRun) : undefined}>
        {schedule ? fromNow(schedule.nextRun) : <span className="dim">–</span>}
      </td>
      <td>
        <Recent runs={runs} label={`recent runs of ${pipelines.title(name)}`} />
        {runs.length === 0 && <span className="dim small">{all.length ? "–" : "never ran"}</span>}
      </td>
      <td title={s ? when(s.last.createdAt) : undefined}>
        {s && (
          <span className="group-last">
            <Status status={s.last.status} /> <span className="dim small">{ago(s.last.createdAt)}</span>
          </span>
        )}
      </td>
      <td className="small">
        {finished.length > 0 ? (
          <span className={ok < finished.length ? "error" : ""}>
            {ok} of {finished.length}
          </span>
        ) : (
          <span className="dim">–</span>
        )}
      </td>
      <td className="small">{s?.usually !== undefined ? duration(s.usually) : <span className="dim">–</span>}</td>
    </tr>
  );
}

export function StatusFilter({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <select aria-label="status" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">any status</option>
      {RUN_STATUSES.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
}

// Summary is how a pipeline's runs went, from the newest first.
export function summary(hs: Run[]) {
  const failed = hs.filter((h) => h.status === "failed" || h.status === "stuck").length;
  const running = hs.filter((h) => h.status === "running").length;
  const times = hs.filter((h) => h.finishedAt).map((h) => took(h.createdAt, h.finishedAt)!);
  return { last: hs[0], failed, running, usually: times.length ? median(times) : undefined };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// RunsTable lists runs: what went in, how far they got, how long they took
// and what came out. With pipelines, it says which pipeline each run is of.
export function RunsTable({ runs, pipelines }: { runs: Run[]; pipelines?: Pipelines }) {
  if (runs.length === 0) return <p className="dim">no runs match</p>;
  const now = Date.now();
  return (
    <table className="runs">
      <thead>
        <tr>
          {pipelines && <th>pipeline</th>}
          <th>
            inputs <Hint word="inputs" />
          </th>
          <th>status</th>
          <th>steps</th>
          <th>started</th>
          <th>took</th>
          <th>result</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((h) => {
          const t = took(h.createdAt, h.finishedAt, now);
          return (
            <tr key={h.id} className="clickable" onClick={() => navigate({ name: "run", id: h.id })}>
              {pipelines && (
                <td>
                  <Link to={{ name: "pipeline", run: h.name }} className="strong" onClick={(e) => e.stopPropagation()}>
                    {pipelines.title(h.name)}
                  </Link>
                  {h.parentId && <div className="dim small">part of another run</div>}
                </td>
              )}
              <td>
                <Values json={h.paramsJson} empty="none" />
              </td>
              <td>
                <Status status={h.status} />
                {h.status === "running" && h.waiting && (
                  <div className="small">
                    <Waiting waiting={h.waiting} short />
                  </div>
                )}
              </td>
              <td className="dim">{steps(h)}</td>
              <td title={when(h.createdAt)}>{ago(h.createdAt, now)}</td>
              <td>{t === undefined ? "–" : duration(t) + (h.finishedAt ? "" : " so far")}</td>
              <td>
                {h.status === "failed" || h.status === "stuck" ? (
                  <span className="error">{h.message || h.reason}</span>
                ) : (
                  <Values json={h.resultJson} />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// StartRun starts a run of one pipeline with the inputs given as JSON, an
// object, in an editor: it starts from inputs (the latest run's, pretty) and
// says what is wrong as you type.
export function StartRun({ run, inputs }: { run: string; inputs: string }) {
  const api = useApi();
  const [params, setParams] = useState<string>();
  const [error, setError] = useState("");
  const start = pretty(inputs || "{}");
  const value = params ?? start;
  const invalid = jsonError(value) || (isObject(value) ? "" : "inputs must be a JSON object, e.g. {\"day\": \"2026-10-24\"}");

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    if (invalid) return;
    try {
      const res = await api.runs.startRun({ tenant: "default", name: run, paramsJson: value.trim() || "{}", trigger: "the web UI" });
      navigate({ name: "run", id: res.runId });
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <form className="start-form" onSubmit={submit}>
      <div className="start-head">
        <span className="dim small">inputs (JSON)</span>
        <span className="start-tools">
          <button type="button" className="link-button" onClick={() => setParams(pretty(value))} disabled={!!jsonError(value)}>
            Format
          </button>
          <button type="button" className="link-button" onClick={() => setParams(undefined)} disabled={params === undefined || params === start}>
            Reset
          </button>
        </span>
      </div>
      <JsonEditor label="inputs" value={value} onChange={setParams} onSubmit={() => void submit()} error={invalid} />
      <div className="start-foot">
        <button type="submit" disabled={!!invalid}>
          Start a run
        </button>
        <span className="dim small">{isMac ? "⌘" : "Ctrl"}+Enter</span>
        {invalid && <span className="error small">{invalid}</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  );
}

function isObject(text: string): boolean {
  if (!text.trim()) return true; // nothing: no inputs
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}
