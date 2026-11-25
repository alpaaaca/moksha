import { useEffect, useState } from "react";

import { useApi } from "./api";
import { Icon, Logo } from "./icons";
import { usePoll } from "./hooks";
import { broken, useLoopRuns } from "./loops";
import { groupLabel, usePipelines, type Pipelines } from "./pipelines";
import { Link, useRoute, type Route } from "./router";
import { Activity } from "./views/Activity";
import { Home } from "./views/Home";
import { Loops } from "./views/Loops";
import { Palette } from "./views/Palette";
import { Pipeline } from "./views/Pipeline";
import { RunDetail } from "./views/RunDetail";
import { RunList } from "./views/RunList";
import { Signals } from "./views/Signals";
import { WorkersPage } from "./views/WorkersPage";
import { useSignalWaits } from "./waits";

// App: a sidebar to move between pages, the page, and a palette (⌘K) to
// jump to any group, pipeline or recent run.
export function App() {
  const route = useRoute();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return (
    <div className="shell">
      <Sidebar route={route} onSearch={() => setPalette(true)} />
      <main>
        {route.name === "run" ? (
          <RunDetail key={route.id} id={route.id} step={route.step} />
        ) : route.name === "pipeline" ? (
          <Pipeline run={route.run} tab={route.tab ?? "overview"} />
        ) : route.name === "runs" ? (
          <RunList key={route.group} group={route.group} />
        ) : route.name === "signals" ? (
          <Signals key={route.group} group={route.group} />
        ) : route.name === "loops" ? (
          <Loops key={route.group} group={route.group} />
        ) : route.name === "activity" ? (
          <Activity />
        ) : route.name === "workers" ? (
          <WorkersPage />
        ) : (
          <Home />
        )}
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// useRunName is the pipeline of the run a page shows, so the sidebar knows its group.
function useRunName(id?: string): string | undefined {
  const api = useApi();
  const res = usePoll(() => (id ? api.runs.getRun({ runId: id }) : Promise.resolve(undefined)), [id], 0);
  return id ? res.data?.run?.name : undefined;
}

// Sidebar: at home, the groups and what is apart from any group. In a
// group (on its pages, and on its pipelines' and runs' pages), its three
// kinds of work each have a place: what ends, what waits for someone, what
// never ends; then, apart, the records and the machines.
function Sidebar({ route, onSearch }: { route: Route; onSearch: () => void }) {
  const pipelines = usePipelines();
  const runName = useRunName(route.name === "run" ? route.id : undefined);
  const group =
    "group" in route ? route.group
    : route.name === "pipeline" ? (pipelines.loaded ? pipelines.group(route.run) : undefined)
    : runName && pipelines.loaded ? pipelines.group(runName)
    : undefined;
  // A pipeline's page is under Pipelines, a loop's under Loops; a run's under its pipeline's.
  const of = route.name === "pipeline" ? route.run : runName;
  const at = of ? (pipelines.info(of)?.loops ? "loops" : "runs") : route.name;
  const loops = group ? pipelines.loops.filter((n) => pipelines.group(n) === group) : [];
  const cls = (on: boolean, apart = false) => [on && "active", apart && "nav-apart"].filter(Boolean).join(" ");

  return (
    <aside className="sidebar">
      <Link to={{ name: "home" }} className="brand">
        <Logo /> moksha
      </Link>
      <button type="button" className="search" onClick={onSearch}>
        <Icon name="search" size={14} />
        <span>Search</span>
        <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <nav className="sidenav" aria-label="main">
        {group === undefined ? (
          <Link to={{ name: "home" }} className={cls(route.name === "home")}>
            <Icon name="group" size={15} />
            Groups
          </Link>
        ) : (
          <>
            <Link to={{ name: "home" }} className="nav-back">
              <Icon name="back" size={13} />
              All groups
            </Link>
            <span className="nav-project" title={groupLabel(group)}>
              <Icon name="group" size={14} />
              <span>{groupLabel(group)}</span>
            </span>
            <Link to={{ name: "runs", group }} className={cls(at === "runs")}>
              <Icon name="pipelines" size={15} />
              Pipelines
            </Link>
            <Link to={{ name: "signals", group }} className={cls(at === "signals")}>
              <Icon name="signals" size={15} />
              Signals
              <SignalsCount group={group} pipelines={pipelines} />
            </Link>
            <Link to={{ name: "loops", group }} className={cls(at === "loops")}>
              <Icon name="loops" size={15} />
              Loops
              {loops.length > 0 && <LoopsCount names={loops} />}
            </Link>
          </>
        )}
        <Link to={{ name: "activity" }} className={cls(route.name === "activity" || (route.name === "run" && group === undefined), true)}>
          <Icon name="runs" size={15} />
          Runs
        </Link>
        <Link to={{ name: "workers" }} className={cls(route.name === "workers")}>
          <Icon name="workers" size={15} />
          Workers
        </Link>
      </nav>
      <Health />
    </aside>
  );
}

const COUNTS_MS = 5000;

// The counts say from any page of a group what its Pipelines page leaves
// out: how much waits for an answer, and how many loops broke.
function SignalsCount({ group, pipelines }: { group: string; pipelines: Pipelines }) {
  const n = useSignalWaits(COUNTS_MS).waits?.filter((w) => pipelines.group(w.run.name) === group).length;
  return n ? <span className="nav-count" title={`${n} waiting for a signal`}>{n}</span> : null;
}

function LoopsCount({ names }: { names: string[] }) {
  const n = useLoopRuns(COUNTS_MS).loops(names).filter(broken).length;
  return n ? <span className="nav-count bad" title={`${n} failed or stuck`}>{n}</span> : null;
}

// Health says whether the server answers, and how many workers it sees.
function Health() {
  const api = useApi();
  const workers = usePoll(() => api.runs.listWorkers({}), [], 5000);
  const up = !!workers.data && !workers.error;
  const n = workers.data?.workers.length ?? 0;
  return (
    <div className="sidebar-foot">
      <span className={`health ${up ? "up" : workers.error ? "down" : ""}`}>
        <span className="dot" aria-hidden="true" />
        {up ? `connected · ${n} ${n === 1 ? "worker" : "workers"}` : workers.error ? "can't reach the server" : "connecting…"}
      </span>
      <span>times in UTC</span>
    </div>
  );
}
