import { useApi } from "./api";
import type { Pipeline, Schedule, Subscription } from "./gen/moksha/v1/run_pb";
import { usePoll } from "./hooks";
import type { Route } from "./router";

export type Pipelines = {
  // title is what to call a run: its title in code, else its name.
  title: (name: string) => string;
  // home is the page a pipeline is listed on.
  home: (name: string) => { label: string; to: Route };
  // trail is the crumbs above a pipeline's page: its home, and its group if it has one.
  trail: (name: string) => { label: string; to: Route }[];
  info: (name: string) => Pipeline | undefined;
  // The runs the registered builds define, by name: those that end, and
  // the loops, which run until stopped.
  names: string[];
  loops: string[];
  loaded: boolean;
  schedule: (name: string) => Schedule | undefined;
  subscription: (name: string) => Subscription | undefined;
};

// usePipelines loads the pipelines the registered builds define, with their
// titles, schedules and subscriptions; they change only when new code
// registers, so it reloads rarely.
export function usePipelines(): Pipelines {
  const api = useApi();
  const res = usePoll(() => api.runs.listPipelines({}), [], 15000);
  const triggers = usePoll(() => api.runs.listSchedules({}), [], 15000);
  const byName = new Map((res.data?.pipelines ?? []).map((p) => [p.name, p]));
  const home = (name: string): { label: string; to: Route } =>
    byName.get(name)?.loops ? { label: "Loops", to: { name: "loops" } } : { label: "Pipelines", to: { name: "runs" } };
  return {
    title: (name) => byName.get(name)?.title || name,
    home,
    trail: (name) => {
      const p = byName.get(name);
      return p?.group && !p.loops ? [home(name), { label: p.group, to: { name: "group", group: p.group } }] : [home(name)];
    },
    info: (name) => byName.get(name),
    names: [...byName.values()].filter((p) => !p.loops).map((p) => p.name),
    loops: [...byName.values()].filter((p) => p.loops).map((p) => p.name),
    loaded: !!res.data,
    schedule: (name) => triggers.data?.schedules.find((s) => s.pipeline === name),
    subscription: (name) => triggers.data?.subscriptions.find((s) => s.pipeline === name),
  };
}
