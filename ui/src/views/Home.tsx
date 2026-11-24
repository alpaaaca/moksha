import type { ReactNode } from "react";

import type { Run } from "../gen/moksha/v1/run_pb";
import { ago, fromNow, ms, when } from "../format";
import { Icon } from "../icons";
import { broken, useLoopRuns, type Loop } from "../loops";
import { groupLabel, usePipelines, type Group, type Pipelines } from "../pipelines";
import { Link, navigate, type Route } from "../router";
import { parked, useSignalWaits, type Wait } from "../waits";
import { failing, Recent, useOverview } from "./RunList";

const EVERY = 5000;

// Home: the groups (@pipeline(group=)), a card each. A card is a way in,
// not a summary to read: it says what is going on in the group right now,
// and its three doors (Pipelines, Signals, Loops) each pass straight to
// that work. Which project deployed it is a detail on the card.
export function Home() {
  const pipelines = usePipelines();
  const { overview, byName, ready } = useOverview(pipelines);
  const { waits } = useSignalWaits(EVERY);
  const loopRuns = useLoopRuns(EVERY);
  const groups = pipelines.groups;
  const states = groups.map((p) => groupState(p, pipelines, byName, waits ?? [], loopRuns.loaded ? loopRuns.loops(p.loops) : []));
  const attention = states.filter((s) => s.tone === "bad" || s.tone === "warn");

  return (
    <section className="home">
      <div className="page-head">
        <h1>Groups</h1>
      </div>
      <p className="lede">Each group is its own place: its pipelines, what waits on you there, and what keeps running. Pick one to go in.</p>
      {overview.error && <p className="error">{overview.error}</p>}
      {ready && attention.length > 0 && (
        <ul className="attention" aria-label="needs you">
          {attention.map((s) => (
            <li key={s.group.name}>
              <Link to={s.needs.to} className={`attention-chip tone-${s.tone}`}>
                <span className="dot" aria-hidden="true" />
                <span className="strong">{groupLabel(s.group.name)}</span>
                <span>{s.needs.label}</span>
                <Icon name="arrow" size={13} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!ready && !overview.error && <p className="dim">loading…</p>}
      {ready && groups.length === 0 && (
        <p className="empty">
          No pipelines yet. Run <code>moksha dev</code> in a project's directory, or <code>moksha deploy</code> it to this server.
        </p>
      )}
      {ready && groups.length > 0 && (
        <ul className="projects">
          {states.map((s) => (
            <GroupCard key={s.group.name} state={s} pipelines={pipelines} />
          ))}
        </ul>
      )}
    </section>
  );
}

type Tone = "bad" | "warn" | "run" | "quiet";

type State = {
  group: Group;
  runs: Run[];
  running: number;
  failing: string[];
  waits: Wait[];
  loops: Loop[];
  tone: Tone;
  word: string;
  // The one thing to look at first, when there is one.
  needs: { label: string; to: Route };
};

// groupState sums a group up: its runs (newest first, parked ones left
// to Signals), what failed last time, what waits, how its loops are.
function groupState(group: Group, pipelines: Pipelines, byName: Map<string, Run[]>, all: Wait[], loops: Loop[]): State {
  const runs = group.names
    .flatMap((n) => byName.get(n) ?? [])
    .filter((h) => !parked(h))
    .sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0));
  const bad = group.names.filter((n) => failing(byName.get(n) ?? []));
  const waits = all.filter((w) => pipelines.group(w.run.name) === group.name);
  const running = runs.filter((h) => h.status === "running").length;
  const looping = loops.filter((l) => l.live.length).length;
  const brokenLoops = loops.filter(broken).length;
  const g = group.name;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  if (bad.length || brokenLoops) {
    return {
      group, runs, running, failing: bad, waits, loops, tone: "bad", word: "needs a look",
      needs: bad.length
        ? { label: `${plural(bad.length, "pipeline")} failed last time`, to: { name: "runs", group: g } }
        : { label: `${plural(brokenLoops, "loop")} stopped or stuck`, to: { name: "loops", group: g } },
    };
  }
  if (waits.length) {
    return { group, runs, running, failing: bad, waits, loops, tone: "warn", word: "waits on you", needs: { label: `${plural(waits.length, "run")} waiting for a signal`, to: { name: "signals", group: g } } };
  }
  const busy = running > 0 || looping > 0;
  return {
    group, runs, running, failing: bad, waits, loops,
    tone: busy ? "run" : "quiet",
    word: busy ? "at work" : "quiet",
    needs: { label: "", to: { name: "runs", group: g } },
  };
}

function GroupCard({ state: s, pipelines }: { state: State; pipelines: Pipelines }) {
  const p = s.group;
  const looping = s.loops.filter((l) => l.live.length).length;
  const brokenLoops = s.loops.filter(broken).length;
  const soonest = s.waits.find((w) => w.wait.timesOutAt);
  const last = s.runs[0];
  const enter: Route = { name: "runs", group: p.name };

  return (
    <li
      className={`project-card tone-${s.tone}${s.running || looping ? " busy" : ""}`}
      aria-label={`group ${groupLabel(p.name)}`}
      onClick={() => navigate(enter)}
    >
      <div className="project-top">
        <span className="project-mark" aria-hidden="true">
          <Icon name="group" size={18} />
        </span>
        <div className="project-id">
          <Link to={enter} className="project-name" onClick={(e) => e.stopPropagation()}>
            {groupLabel(p.name)}
          </Link>
          <span className="dim small">
            {p.deployments.length ? (
              p.deployments.map((d, i) => (
                <span key={d.project} title={`build ${d.buildId}${d.by ? `, deployed by ${d.by}` : ""}, ${when(d.deployedAt)}${d.image || d.dir ? `, from ${d.image || d.dir}` : ""}`}>
                  {i > 0 && " · "}project {d.project} v{d.version} · deployed {ago(d.deployedAt)}
                </span>
              ))
            ) : (
              "no project deployed it"
            )}
          </span>
        </div>
        <span className="project-state">
          <span className="dot" aria-hidden="true" />
          {s.word}
        </span>
      </div>

      <div className="project-pulse">
        {s.runs.length > 0 ? (
          <>
            <Recent runs={s.runs.slice(0, 24)} label={`recent runs in ${groupLabel(p.name)}`} pipelines={pipelines} />
            <span className="dim small" title={when(last.createdAt)}>
              last run {ago(last.createdAt)} · {pipelines.title(last.name)}
            </span>
          </>
        ) : (
          <span className="dim small">no runs yet</span>
        )}
      </div>

      <nav className="doors" aria-label={`into ${groupLabel(p.name)}`} onClick={(e) => e.stopPropagation()}>
        <Door to={enter} icon="pipelines" label="Pipelines" count={p.names.length} tone={s.failing.length ? "bad" : s.running ? "run" : "quiet"}>
          {s.failing.length ? `${s.failing.length} failed last time` : s.running ? `${s.running} running` : "that end"}
        </Door>
        <span className="door-link" aria-hidden="true" />
        <Door to={{ name: "signals", group: p.name }} icon="signals" label="Signals" count={s.waits.length} tone={s.waits.length ? "warn" : "quiet"}>
          {s.waits.length ? (soonest ? `one times out ${fromNow(soonest.wait.timesOutAt)}` : "waiting on you") : "nothing waits"}
        </Door>
        <span className="door-link" aria-hidden="true" />
        <Door to={{ name: "loops", group: p.name }} icon="loops" label="Loops" count={p.loops.length} tone={brokenLoops ? "bad" : looping ? "run" : "quiet"}>
          {brokenLoops ? `${brokenLoops} needs a look` : looping ? `${looping} looping` : p.loops.length ? "not running" : "none"}
        </Door>
      </nav>
    </li>
  );
}

function Door({ to, icon, label, count, tone, children }: { to: Route; icon: string; label: string; count: number; tone: Tone; children: ReactNode }) {
  return (
    <Link to={to} className={`door tone-${tone}`} label={`${label}: ${count}`}>
      <span className="door-head">
        <Icon name={icon} size={14} />
        {label}
        <Icon name="arrow" size={13} />
      </span>
      <span className="door-count">{count}</span>
      <span className="door-sub">{children}</span>
    </Link>
  );
}
