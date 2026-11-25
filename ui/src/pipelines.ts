import { useApi } from "./api";
import type { Deployment } from "./gen/moksha/v1/deploy_pb";
import type { Pipeline, Schedule, Subscription } from "./gen/moksha/v1/run_pb";
import { usePoll } from "./hooks";
import { LOOSE, type Route } from "./router";

// A group as the web UI shows it: a namespace of pipelines, named in their
// code (@pipeline(group="shop")); LOOSE holds those that name none. Its
// deployments are the projects that deployed its pipelines, as now.
export type Group = { name: string; deployments: Deployment[]; names: string[]; loops: string[] };

export type Pipelines = {
  // title is what to call a run: its title in code, else its name.
  title: (name: string) => string;
  // group is the group a pipeline is in (LOOSE if its code names none).
  group: (name: string) => string;
  // home is the page a pipeline is listed on: its group's Pipelines or Loops.
  home: (name: string) => { label: string; to: Route };
  // trail is the crumbs above a pipeline's page: the groups, its group,
  // and Loops for a loop.
  trail: (name: string) => { label: string; to: Route }[];
  info: (name: string) => Pipeline | undefined;
  // The runs the registered builds define, by name: those that end, and
  // the loops, which run until stopped.
  names: string[];
  loops: string[];
  // The groups, by name, with LOOSE last if any pipeline is in it.
  groups: Group[];
  loaded: boolean;
  schedule: (name: string) => Schedule | undefined;
  subscription: (name: string) => Subscription | undefined;
};

// groupLabel is what to call a group in front of people.
export function groupLabel(group: string): string {
  return group === LOOSE ? "Not in a group" : group;
}

// usePipelines loads the pipelines the registered builds define, with their
// titles, groups, schedules and subscriptions, and the projects that
// deployed them; they change only when new code registers, so it reloads
// rarely. A server that can't list projects just shows no deployments.
export function usePipelines(): Pipelines {
  const api = useApi();
  const res = usePoll(() => api.runs.listPipelines({}), [], 15000);
  const triggers = usePoll(() => api.runs.listSchedules({}), [], 15000);
  const deployed = usePoll(() => api.deploy.listProjects({}).catch(() => ({ projects: [] as Deployment[] })), [], 15000);
  const byName = new Map((res.data?.pipelines ?? []).map((p) => [p.name, p]));
  const group = (name: string) => byName.get(name)?.group || LOOSE;

  const byGroup = new Map<string, Group>();
  for (const p of byName.values()) {
    const g = group(p.name);
    if (!byGroup.has(g)) byGroup.set(g, { name: g, deployments: [], names: [], loops: [] });
    const into = byGroup.get(g)!;
    (p.loops ? into.loops : into.names).push(p.name);
  }
  for (const d of deployed.data?.projects ?? []) {
    if (d.deletedAt) continue;
    for (const g of new Set(d.pipelines.filter((n) => byName.has(n)).map(group))) byGroup.get(g)?.deployments.push(d);
  }
  const groups = [...byGroup.values()].sort((a, b) => (a.name === LOOSE ? 1 : b.name === LOOSE ? -1 : a.name.localeCompare(b.name)));

  const home = (name: string): { label: string; to: Route } =>
    byName.get(name)?.loops ? { label: "Loops", to: { name: "loops", group: group(name) } } : { label: "Pipelines", to: { name: "runs", group: group(name) } };
  return {
    title: (name) => byName.get(name)?.title || name,
    group,
    home,
    trail: (name) => {
      const up = [{ label: "Groups", to: { name: "home" } as Route }, { label: groupLabel(group(name)), to: { name: "runs", group: group(name) } as Route }];
      return byName.get(name)?.loops ? [...up, home(name)] : up;
    },
    info: (name) => byName.get(name),
    names: [...byName.values()].filter((p) => !p.loops).map((p) => p.name),
    loops: [...byName.values()].filter((p) => p.loops).map((p) => p.name),
    groups,
    loaded: !!res.data && !!deployed.data,
    schedule: (name) => triggers.data?.schedules.find((s) => s.pipeline === name),
    subscription: (name) => triggers.data?.subscriptions.find((s) => s.pipeline === name),
  };
}
