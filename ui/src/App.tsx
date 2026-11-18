import { useEffect, useState } from "react";

import { useApi } from "./api";
import { Icon, Logo } from "./icons";
import { usePoll } from "./hooks";
import { Link, useRoute, type Route } from "./router";
import { Activity } from "./views/Activity";
import { Palette } from "./views/Palette";
import { Pipeline } from "./views/Pipeline";
import { RunDetail } from "./views/RunDetail";
import { RunList } from "./views/RunList";
import { WorkersPage } from "./views/WorkersPage";

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
        ) : route.name === "activity" ? (
          <Activity />
        ) : route.name === "workers" ? (
          <WorkersPage />
        ) : (
          <RunList />
        )}
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

const PAGES: { route: Route; label: string; icon: string; on: Route["name"][] }[] = [
  { route: { name: "runs" }, label: "Pipelines", icon: "pipelines", on: ["runs", "pipeline"] },
  { route: { name: "activity" }, label: "Runs", icon: "runs", on: ["activity", "run"] },
  { route: { name: "workers" }, label: "Workers", icon: "workers", on: ["workers"] },
];

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Sidebar({ route, onSearch }: { route: Route; onSearch: () => void }) {
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
          <Link key={p.label} to={p.route} className={p.on.includes(route.name) ? "active" : undefined}>
            <Icon name={p.icon} size={15} />
            {p.label}
          </Link>
        ))}
      </nav>
      <Health />
    </aside>
  );
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
