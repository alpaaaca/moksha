import { useEffect, useState } from "react";

import { useApi } from "./api";
import { Icon, Logo } from "./icons";
import { usePoll } from "./hooks";
import { broken, useLoopRuns } from "./loops";
import { usePipelines } from "./pipelines";
import { Link, useRoute, type Route } from "./router";
import { Activity } from "./views/Activity";
import { Loops } from "./views/Loops";
import { Palette } from "./views/Palette";
import { Pipeline } from "./views/Pipeline";
import { RunDetail } from "./views/RunDetail";
import { GroupPage, RunList } from "./views/RunList";
import { Signals } from "./views/Signals";
import { WorkersPage } from "./views/WorkersPage";
import { useSignalWaits } from "./waits";

// App: a sidebar to move between pages, the page, and a palette (⌘K) to
// jump to any pipeline or recent run.
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
        ) : route.name === "signals" ? (
          <Signals />
        ) : route.name === "loops" ? (
          <Loops />
        ) : route.name === "activity" ? (
          <Activity />
        ) : route.name === "workers" ? (
          <WorkersPage />
        ) : route.name === "group" ? (
          <GroupPage key={route.group} group={route.group} />
        ) : (
          <RunList />
        )}
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

// The three kinds of work each have a place: what ends, what waits for
// someone, what never ends. Then (apart) the records and the machines.
const PAGES: { route: Route; label: string; icon: string; on: Route["name"][]; apart?: boolean }[] = [
  { route: { name: "runs" }, label: "Pipelines", icon: "pipelines", on: ["runs", "group", "pipeline"] },
  { route: { name: "signals" }, label: "Signals", icon: "signals", on: ["signals"] },
  { route: { name: "loops" }, label: "Loops", icon: "loops", on: ["loops"] },
  { route: { name: "activity" }, label: "Runs", icon: "runs", on: ["activity", "run"], apart: true },
  { route: { name: "workers" }, label: "Workers", icon: "workers", on: ["workers"] },
];

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Sidebar({ route, onSearch }: { route: Route; onSearch: () => void }) {
  const pipelines = usePipelines();
  // A loop's page is the pipeline's, but belongs under Loops.
  const at = route.name === "pipeline" && pipelines.info(route.run)?.loops ? "loops" : route.name;
  return (
    <aside className="sidebar">
      <Link to={{ name: "runs" }} className="brand">
        <Logo /> moksha
      </Link>
      <button type="button" className="search" onClick={onSearch}>
        <Icon name="search" size={14} />
        <span>Search</span>
        <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <nav className="sidenav" aria-label="main">
        {PAGES.map((p) => (
          <Link key={p.label} to={p.route} className={[p.on.includes(at) && "active", p.apart && "nav-apart"].filter(Boolean).join(" ")}>
            <Icon name={p.icon} size={15} />
            {p.label}
            {p.route.name === "signals" && <SignalsCount />}
            {p.route.name === "loops" && pipelines.loops.length > 0 && <LoopsCount names={pipelines.loops} />}
          </Link>
        ))}
      </nav>
      <Health />
    </aside>
  );
}

const COUNTS_MS = 5000;

// The counts say from any page what the Pipelines page leaves out: how
// much waits for an answer, and how many loops broke.
function SignalsCount() {
  const n = useSignalWaits(COUNTS_MS).waits?.length;
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
