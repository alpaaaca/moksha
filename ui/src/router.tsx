// A hash router. #/ (the groups, @pipeline(group=)), then a group's three
// places: #/groups/<group> (its pipelines), #/groups/<group>/signals,
// #/groups/<group>/loops; #/pipelines/<run name>[/<tab>], #/runs/<id>
// (one run), #/runs/<id>/<seq> (one run, one step's logs), and apart from
// any group #/activity (all runs) and #/workers. Pipelines whose code names
// no group are in the group LOOSE. Hash routes need nothing from the
// server, which serves index.html for every path anyway.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

// A pipeline page's tabs; the first is the default, left out of its URL.
export const PIPELINE_TABS = ["runs", "steps", "workers", "start"] as const;
export type PipelineTab = (typeof PIPELINE_TABS)[number];

// LOOSE stands for the pipelines whose code names no group.
export const LOOSE = "~";

export type Route =
  | { name: "home" }
  | { name: "runs"; group: string }
  | { name: "signals"; group: string }
  | { name: "loops"; group: string }
  | { name: "activity" }
  | { name: "workers" }
  | { name: "pipeline"; run: string; tab?: PipelineTab }
  | { name: "run"; id: string; step?: number };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "runs" && parts[1]) return { name: "run", id: parts[1], step: Number(parts[2]) || undefined };
  if (parts[0] === "groups" && parts[1]) {
    const group = parts[1];
    if (parts[2] === "signals") return { name: "signals", group };
    if (parts[2] === "loops") return { name: "loops", group };
    return { name: "runs", group };
  }
  if (parts[0] === "activity") return { name: "activity" };
  if (parts[0] === "workers") return { name: "workers" };
  if (parts[0] === "pipelines" && parts[1]) {
    const tab = PIPELINE_TABS.find((t) => t === parts[2]);
    return tab && tab !== "runs" ? { name: "pipeline", run: parts[1], tab } : { name: "pipeline", run: parts[1] };
  }
  return { name: "home" };
}

export function href(r: Route): string {
  const g = (group: string) => `#/groups/${encodeURIComponent(group)}`;
  switch (r.name) {
    case "run":
      return `#/runs/${encodeURIComponent(r.id)}` + (r.step ? `/${r.step}` : "");
    case "runs":
      return g(r.group);
    case "signals":
    case "loops":
      return `${g(r.group)}/${r.name}`;
    case "pipeline":
      return `#/pipelines/${encodeURIComponent(r.run)}` + (r.tab && r.tab !== "runs" ? `/${r.tab}` : "");
    case "activity":
    case "workers":
      return `#/${r.name}`;
    default:
      return "#/";
  }
}

export function navigate(r: Route) {
  window.location.hash = href(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

type LinkProps = {
  to: Route;
  children: ReactNode;
  className?: string;
  label?: string;
  onClick?: (e: MouseEvent) => void;
  role?: string;
  selected?: boolean;
};

export function Link({ to, children, className, label, onClick, role, selected }: LinkProps) {
  return (
    <a href={href(to)} className={className} aria-label={label} title={label} onClick={onClick} role={role} aria-selected={selected}>
      {children}
    </a>
  );
}
