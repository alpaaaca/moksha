import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate, timestampMs, type Timestamp } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiProvider, apiFor } from "./api";
import { App } from "./App";
import { href, parse } from "./router";
import { utcDay } from "./views/PipelineRuns";
import { RunSchema, RunService, StepCountsSchema, StepSchema } from "./gen/moksha/v1/run_pb";
import { LogService } from "./gen/moksha/v1/log_pb";
import { DeployService } from "./gen/moksha/v1/deploy_pb";

const start = new Date(2026, 9, 24, 3, 0, 0);
const at = (seconds: number) => timestampFromDate(new Date(start.getTime() + seconds * 1000));
const t0 = at(0);

function run(id: string, name: string, status: string, extra: MessageInitShape<typeof RunSchema> = {}) {
  return create(RunSchema, { id, tenant: "default", name, status, createdAt: t0, ...extra });
}

// Runs and loops to serve in place of the usual ones.
// groups: each pipeline's group (none: in no group); projects: each deployed project's pipelines.
type World = { runs: ReturnType<typeof run>[]; loops: string[]; groups?: Record<string, string>; projects?: Record<string, string[]> };

// A RunService in memory, recording what the UI asked.
function fakeServer(world?: World) {
  const calls: Record<string, unknown[]> = {};
  const record = (m: string, req: unknown) => (calls[m] ??= []).push(req);
  const daily = run("01M6AAAAAAAAAAAAAAAAAAAAAA", "daily", "running", {
    paramsJson: '{"day":"2026-10-24"}',
    trigger: "schedule",
    stepCounts: create(StepCountsSchema, { total: 3, completed: 2, reused: 1 }),
    steps: [
      create(StepSchema, {
        seq: 1, name: "extract", status: "completed", attempts: 1, runReason: "no previous run", why: "it ran because it hasn't run with these inputs before",
        dataVersion: "01M6DATAVERSIONDATAVER0001", scheduledAt: at(0), finishedAt: at(2.5), resultJson: '{"rows": 6}', dataset: "raw.orders",
      }),
      create(StepSchema, { seq: 2, name: "build", status: "completed", attempts: 0, reused: true, why: "same inputs and same code as before, so it didn't run again", scheduledAt: at(3), finishedAt: at(3), after: [1], dataset: "mart.revenue" }),
      create(StepSchema, { seq: 3, name: "report", status: "dispatched", attempts: 1, runReason: "code changed", scheduledAt: at(3), after: [2] }),
    ],
  });
  const done = run("01M6DDDDDDDDDDDDDDDDDDDDDD", "daily", "completed", {
    paramsJson: '{"day":"2026-10-23"}',
    finishedAt: at(4),
    resultJson: '{"orders": 6, "total": "775.99"}',
    stepCounts: create(StepCountsSchema, { total: 3, completed: 3, reused: 3 }),
  });
  const stuck = run("01M6BBBBBBBBBBBBBBBBBBBBBB", "hourly", "stuck", { reason: "nondeterminism", message: "time.time() called" });
  const broken = run("01M6EEEEEEEEEEEEEEEEEEEEEE", "daily", "failed", {
    paramsJson: '{"day":"2026-10-22"}',
    finishedAt: at(2),
    reason: "StepFailed",
    steps: [
      create(StepSchema, { seq: 1, name: "extract", status: "completed", runReason: "not memoized", sameResultRuns: 2, scheduledAt: at(0), finishedAt: at(1) }),
      create(StepSchema, { seq: 2, name: "build", status: "failed", reason: "ValueError", message: "no orders", scheduledAt: at(1), finishedAt: at(2), after: [1] }),
    ],
  });
  const waiter = run("01M6WWWWWWWWWWWWWWWWWWWWWW", "daily", "running", {
    paramsJson: '{"day":"2026-10-25"}',
    waiting: {
      reason: "no_worker", kind: "run", name: "daily", queue: "default", since: t0,
      message: "no worker is connected to run the pipeline's code. Deploy its project: `moksha dev` in its directory, or `moksha deploy`",
    },
  });
  const runLogs: Record<string, { seq: number; step: string; attempt: number; line: { time: Timestamp; stream: string; level?: string; text: string } }[]> = {
    [daily.id]: [
      { seq: 1, step: "extract", attempt: 1, line: { time: at(0.1), stream: "stdout", text: "reading 6 orders" } },
      { seq: 2, step: "build", attempt: 1, line: { time: at(3.1), stream: "log", level: "WARNING", text: "one order has no region" } },
    ],
    [broken.id]: [
      { seq: 1, step: "extract", attempt: 1, line: { time: at(0.1), stream: "stdout", text: "reading 0 orders" } },
      { seq: 2, step: "build", attempt: 1, line: { time: at(1.1), stream: "stderr", text: "ValueError: no orders" } },
    ],
  };
  const transport = createRouterTransport(({ service }) => {
    service(RunService, {
      listRuns(req) {
        record("listRuns", req);
        if (req.parentId) return { runs: [run("01M6CHILDCHILDCHILDCHILD01", "child", "completed", { parentId: req.parentId })] };
        const all = (world?.runs ?? [daily, done, stuck, broken]).filter(
          (h) => !req.kind || (req.kind === "loop") === !!world?.loops.includes(h.name),
        );
        const t = (h: ReturnType<typeof run>) => timestampMs(h.createdAt!);
        return {
          runs: all.filter(
            (h) =>
              (!req.name || h.name === req.name) &&
              (!req.statuses.length || req.statuses.includes(h.status)) &&
              (!req.createdAfter || t(h) >= timestampMs(req.createdAfter)) &&
              (!req.createdBefore || t(h) < timestampMs(req.createdBefore)),
          ),
        };
      },
      getRun(req) {
        record("getRun", req);
        return { run: [daily, done, stuck, broken, waiter].find((h) => h.id === req.runId) };
      },
      getHistory(req) {
        record("getHistory", req);
        return {
          entries: [
            { eventSeq: 1n, time: t0, kind: "started", text: "Started by its schedule, for day=2026-10-24", eventType: "RunStarted", payloadJson: '{"name":"daily"}' },
            { eventSeq: 2n, time: t0, kind: "engine", text: "Waits for a worker to run the pipeline's code", eventType: "RunTaskQueued", payloadJson: "{}" },
            { eventSeq: 3n, time: at(2.5), kind: "step", seq: 1, step: "extract", text: "done in 2.5 s, wrote a new version of raw.orders for 2026-10-24", eventType: "StepFinished" },
            { eventSeq: 4n, time: at(3), kind: "reused", seq: 2, step: "build", text: "reused the existing version of mart.revenue: same inputs and same code, so it didn't run again (from the run of daily for day=2026-10-23)", runId: "01M6DDDDDDDDDDDDDDDDDDDDDD", eventType: "StepReused" },
          ],
        };
      },
      startRun(req) {
        record("startRun", req);
        return { runId: daily.id };
      },
      cancelRun(req) {
        record("cancelRun", req);
        return {};
      },
      resumeRun(req) {
        record("resumeRun", req);
        return {};
      },
      signalRun(req) {
        record("signalRun", req);
        return { signalId: "s1" };
      },
      listWorkers() {
        record("listWorkers", {});
        return { workers: [] };
      },
      getPipelineWorkers(req) {
        record("getPipelineWorkers", req);
        return {
          workers: [
            { workerId: "host-41", runs: 3, steps: 7, stepsSucceeded: 5, stepsFailed: 1, stepsLost: 1, replays: 4,
              stepMedian: { seconds: 2n, nanos: 500_000_000 }, stepP95: { seconds: 12n }, firstAt: t0, lastAt: t0 },
            { workerId: "host-42", runs: 1, replays: 1, replaysFailed: 1, firstAt: t0, lastAt: t0 },
          ],
        };
      },
      listPools() {
        return {
          pools: [
            { name: "py", queues: ["default"], min: 0, max: 3, workers: ["py-1"], starting: 1, desired: 1, decision: "started py-1: 1 run waits on default", decidedAt: t0 },
            { name: "k8s", queues: ["gpu"], min: 0, max: 5, workers: [], desired: 2, external: true },
          ],
        };
      },
      listPipelines() {
        if (world) {
          const names = new Set([...world.runs.map((h) => h.name), ...world.loops]);
          return { pipelines: [...names].map((name) => ({ name, loops: world.loops.includes(name), group: world.groups?.[name] ?? "" })) };
        }
        return { pipelines: [{ name: "daily", title: "Daily revenue", description: "Orders to a report, per day.", group: "revenue" }, { name: "hourly", group: "revenue" }] };
      },
      listSchedules() {
        const next = timestampFromDate(new Date(Date.now() + 5 * 3600 * 1000));
        const latest = '{"interval":{"$interval":{"end":"2026-10-24T13:00:00Z","start":"2026-10-24T12:00:00Z"}}}';
        return {
          schedules: [
            { pipeline: "daily", cron: "0 3 * * *", timezone: "Europe/Berlin", interval: "daily", nextRun: next },
            { pipeline: "nightly", cron: "5 * * * *", interval: "hourly", nextRun: next, latestParamsJson: latest },
          ],
          subscriptions: [],
        };
      },
    });
    service(DeployService, {
      listProjects() {
        record("listProjects", {});
        const projects = world ? (world.projects ?? {}) : { revenue: ["daily", "hourly"] };
        return {
          projects: Object.entries(projects).map(([project, pipelines], i) => ({
            project, version: i + 3, buildId: `b-${project}`, dir: `/src/${project}`, pipelines, by: "ana", deployedAt: t0,
          })),
        };
      },
    });
    service(LogService, {
      getLogs(req) {
        record("getLogs", req);
        return { lines: (runLogs[req.runId] ?? []).filter((l) => !req.seq || l.seq === req.seq) };
      },
    });
  });
  return { api: apiFor(transport), calls };
}

function show(hash: string, world?: World) {
  window.location.hash = hash;
  const server = fakeServer(world);
  render(
    <ApiProvider api={server.api}>
      <App />
    </ApiProvider>,
  );
  return server;
}

test("a group's Pipelines page: each pipeline's meta information, not its runs", async () => {
  show("#/groups/revenue");
  const table = await screen.findByRole("table");
  const daily = (await within(table).findByRole("link", { name: "Daily revenue" })).closest("tr")!;
  expect(daily).toHaveAttribute("title", "Orders to a report, per day."); // one line: the description on hover
  expect(daily).not.toHaveTextContent("Orders to a report");
  expect(daily).toHaveTextContent("0 3 * * *"); // its cron
  expect(daily).toHaveTextContent("Europe/Berlin");
  expect(daily).toHaveTextContent("in 5 h"); // next run
  expect(daily).toHaveTextContent("1 of 2"); // of its finished runs, 1 succeeded
  expect(daily).toHaveTextContent("4.0 s"); // usually takes
  // Recent runs: a square each, oldest first.
  const recent = within(daily).getByLabelText("recent runs of Daily revenue");
  expect(within(recent).getAllByRole("link").map((a) => a.className)).toEqual([
    "recent-run run-failed", "recent-run run-completed", "recent-run run-running",
  ]);
  const hourly = within(table).getByRole("link", { name: "hourly" }).closest("tr")!;
  expect(hourly).toHaveTextContent("on demand");
  // No list of runs here: they are on each pipeline's page.
  expect(screen.queryByText("2026-10-23")).not.toBeInTheDocument();

  await userEvent.click(daily);
  await waitFor(() => expect(window.location.hash).toBe("#/pipelines/daily"));
});

test("a pipeline opens on its runs; a tab each for its workers and starting one", async () => {
  const { calls } = show("#/pipelines/daily");
  expect(await screen.findByRole("heading", { name: "Daily revenue" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "breadcrumb" })).toHaveTextContent("GroupsrevenueDaily revenue");
  expect(screen.getByText(/on a schedule/)).toHaveTextContent("0 3 * * * (Europe/Berlin), daily data");
  expect(screen.getByText("next run").nextElementSibling).toHaveTextContent("in 5 h");
  const tabs = screen.getByRole("tablist", { name: "pipeline" });
  expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Runs", "Steps", "Workers", "Start a run"]);
  expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent("Runs");
  // Other tabs' content isn't there, nor asked for.
  expect(screen.queryByLabelText("inputs")).not.toBeInTheDocument();
  expect(calls.getPipelineWorkers).toBeUndefined();

  const panel = screen.getByRole("tabpanel", { name: "Runs" });
  const runs = await within(panel).findByRole("table");
  expect(within(runs).getByText("2026-10-23").closest("tr")).toHaveTextContent("3 steps · all reused");
  await userEvent.selectOptions(screen.getByLabelText("status"), "completed");
  await waitFor(() => expect(within(within(panel).getByRole("table")).queryByText("2026-10-24")).not.toBeInTheDocument());
  expect(calls.listRuns.at(-1)).toMatchObject({ name: "daily", statuses: ["completed"] });
  expect(screen.queryByRole("list", { name: "steps graph" })).not.toBeInTheDocument();

  // Its steps as a graph, as in the latest run, with what each writes.
  await userEvent.click(within(tabs).getByRole("tab", { name: "Steps" }));
  await waitFor(() => expect(window.location.hash).toBe("#/pipelines/daily/steps"));
  const graph = await screen.findByRole("list", { name: "steps graph" });
  expect(within(graph).getAllByRole("listitem").map((n) => n.textContent)).toEqual(["extractraw.orders", "buildmart.revenue", "report"]);
  expect(within(graph).getByTitle("writes raw.orders")).toHaveTextContent("raw.orders");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  // A run opens.
  await userEvent.click(within(tabs).getByRole("tab", { name: "Runs" }));
  await userEvent.click(within(await screen.findByRole("table")).getByText("2026-10-23"));
  await waitFor(() => expect(window.location.hash).toBe("#/runs/01M6DDDDDDDDDDDDDDDDDDDDDD"));

  // Starting a run: the inputs start as the latest run's.
  window.location.hash = "#/pipelines/daily/start";
  const params = await screen.findByLabelText("inputs");
  await waitFor(() => expect(params).toHaveValue('{\n  "day": "2026-10-24"\n}')); // pretty, to edit
  await userEvent.clear(params);
  await userEvent.type(params, "{{}\n  \"day\": 2026-");
  // What is wrong, and where, as you type; nothing starts.
  expect(await screen.findByText(/^line 2, column \d+: /)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start a run" })).toBeDisabled();
  expect(params).toHaveAttribute("aria-invalid", "true");
  await userEvent.clear(params);
  await userEvent.type(params, "[[1]"); // [[ types one [
  expect(await screen.findByText(/inputs must be a JSON object/)).toBeInTheDocument();
  expect(calls.startRun).toBeUndefined();

  await userEvent.clear(params);
  await userEvent.type(params, '{{"day":"2026-10-25"}');
  await userEvent.click(screen.getByRole("button", { name: "Format" }));
  expect(params).toHaveValue('{\n  "day": "2026-10-25"\n}');
  await userEvent.type(params, "{Control>}{Enter}{/Control}"); // starts it, like the button
  await waitFor(() => expect(window.location.hash).toBe("#/runs/01M6AAAAAAAAAAAAAAAAAAAAAA"));
  expect(calls.startRun[0]).toMatchObject({ name: "daily", paramsJson: '{\n  "day": "2026-10-25"\n}', trigger: "the web UI" });
});

test("a pipeline's runs narrow to a day (UTC), then to an hour of it", async () => {
  const { calls } = show("#/pipelines/daily");
  const panel = await screen.findByRole("tabpanel", { name: "Runs" });
  await within(panel).findByRole("table");
  expect(screen.getByLabelText("hour (UTC)")).toBeDisabled(); // an hour only within a day
  expect(screen.queryByRole("group", { name: "runs by hour (UTC)" })).not.toBeInTheDocument();

  // The day the fixture's runs started: the server narrows to it.
  const day = utcDay(start.getTime());
  const hour = start.getUTCHours();
  await userEvent.type(screen.getByLabelText("day (UTC)"), day);
  const hours = await screen.findByRole("group", { name: "runs by hour (UTC)" });
  const from = Date.parse(`${day}T00:00:00Z`);
  await waitFor(() => expect(calls.listRuns.at(-1)).toMatchObject({ name: "daily", limit: 1000 }));
  const req = calls.listRuns.at(-1) as { createdAfter: Timestamp; createdBefore: Timestamp };
  expect([timestampMs(req.createdAfter), timestampMs(req.createdBefore)]).toEqual([from, from + 86400000]);
  const hh = String(hour).padStart(2, "0");
  const busy = within(hours).getByRole("button", { name: `${hh}:00: 3 runs, 1 failed` });
  expect(busy).toHaveClass("hour-bad");
  expect(within(within(panel).getByRole("table")).getAllByRole("row")).toHaveLength(4); // a header and 3 runs

  // An hour with none of them: nothing to list.
  const other = (hour + 5) % 24;
  await userEvent.selectOptions(screen.getByLabelText("hour (UTC)"), String(other));
  expect(within(panel).getByText(/^No runs between/)).toBeInTheDocument();
  // Picking the busy bar narrows to it; again, and it lets go.
  await userEvent.click(busy);
  expect(busy).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/3 runs of 3/)).toBeInTheDocument();
  await userEvent.click(busy);
  expect(screen.getByLabelText("hour (UTC)")).toHaveValue("");

  // The day before has none; Any day goes back to the newest.
  await userEvent.click(screen.getByRole("button", { name: "day before" }));
  expect(await within(panel).findByText("No runs that day.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Any day" }));
  expect(await within(panel).findByRole("table")).toBeInTheDocument();
  expect(calls.listRuns.at(-1)).toMatchObject({ limit: 100 });
});

test("a scheduled pipeline starts by hand with the latest interval as its inputs", async () => {
  show("#/pipelines/nightly/start");
  await waitFor(() => expect(screen.getByLabelText("inputs")).toHaveValue(
      JSON.stringify({ interval: { $interval: { end: "2026-10-24T13:00:00Z", start: "2026-10-24T12:00:00Z" } } }, null, 2),
    ),
  );
  expect(screen.getByText("inputs of the latest interval that came due")).toBeInTheDocument();
});

test("a run: steps on a timeline, children, events, signal and cancel", async () => {
  const { calls } = show("#/runs/01M6AAAAAAAAAAAAAAAAAAAAAA");
  expect(await screen.findByRole("heading", { name: "Daily revenue" })).toBeInTheDocument();
  expect(screen.getByText(/on its schedule/)).toBeInTheDocument();
  const graph = screen.getByRole("list", { name: "steps graph" });
  const nodes = within(graph).getAllByRole("listitem").map((n) => n.textContent);
  expect(nodes.slice(0, 2)).toEqual(["extractcompleted2.5 sraw.orders", "buildreused0 msmart.revenue"]);
  expect(within(graph).getAllByRole("listitem").map((n) => n.className)).toEqual([
    "dag-node node-completed clickable", "dag-node node-reused clickable", "dag-node node-running clickable",
  ]);
  expect(nodes[2]).toMatch(/^reportrunning/); // for as long as it has been running
  const steps = screen.getAllByRole("table")[0];
  const extract = within(steps).getByText("extract").closest("tr")!;
  expect(extract).toHaveTextContent("2.5 s");
  expect(extract).toHaveTextContent("it hasn't run with these inputs before");
  expect(extract).toHaveTextContent("wrote a new version of raw.orders");
  expect(extract).toHaveTextContent("rows 6");
  const build = within(steps).getByText("build").closest("tr")!;
  expect(within(build).getByText("reused")).toBeInTheDocument();
  expect(build).toHaveTextContent("didn't run again");
  expect(within(steps).getByText("report").closest("tr")).toHaveTextContent("running");

  // Logs: all steps, each line marked with its step; a step shows its own.
  const logs = screen.getByRole("log", { name: "log lines" });
  expect(await within(logs).findByText("reading 6 orders")).toBeInTheDocument();
  expect(within(logs).getByText("one order has no region").closest(".log-line")).toHaveTextContent(/build\s*WARNING/);
  await userEvent.click(build);
  await waitFor(() => expect(within(logs).queryByText("reading 6 orders")).not.toBeInTheDocument());
  expect(calls.getLogs.at(-1)).toMatchObject({ runId: "01M6AAAAAAAAAAAAAAAAAAAAAA", seq: 2 });
  expect(screen.getByLabelText("logs of")).toHaveValue("2");
  expect(await screen.findByText("child")).toBeInTheDocument();
  expect(calls.listRuns).toContainEqual(expect.objectContaining({ parentId: "01M6AAAAAAAAAAAAAAAAAAAAAA" }));

  // What happened, in sentences; the engine's bookkeeping only when asked.
  const story = await screen.findByRole("list", { name: "what happened" });
  await waitFor(() => expect(within(story).getAllByRole("listitem")).toHaveLength(3));
  expect(within(story).getAllByRole("listitem")[0]).toHaveTextContent("Started by its schedule, for day=2026-10-24");
  expect(within(story).getAllByRole("listitem")[2]).toHaveTextContent(/build reused the existing version of mart.revenue/);
  expect(within(story).getByRole("link", { name: "open that run" })).toHaveAttribute("href", "#/runs/01M6DDDDDDDDDDDDDDDDDDDDDD");
  expect(within(story).queryByText(/Waits for a worker/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("engine details"));
  expect(within(story).getByText(/Waits for a worker/)).toBeInTheDocument();
  expect(within(story).getByText(/RunTaskQueued/)).toBeInTheDocument();
  await userEvent.click(within(story).getByRole("button", { name: "extract" }));
  expect(screen.getByLabelText("logs of")).toHaveValue("1");
  expect(screen.getByRole("note", { name: /^step: One function call/ })).toBeInTheDocument();
  expect(screen.getByText("2026-10-24")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();

  await userEvent.type(screen.getByLabelText("signal name"), "approve");
  await userEvent.type(screen.getByLabelText("signal payload"), '{{"by": "ana"}');
  await userEvent.click(screen.getByRole("button", { name: "Send signal" }));
  await waitFor(() => expect(calls.signalRun?.[0]).toMatchObject({ name: "approve", payloadJson: '{"by": "ana"}' }));

  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(calls.cancelRun?.[0]).toMatchObject({ runId: "01M6AAAAAAAAAAAAAAAAAAAAAA" }));
});

test("a finished run shows its result", async () => {
  show("#/runs/01M6DDDDDDDDDDDDDDDDDDDDDD");
  expect(await screen.findByRole("heading", { name: /Output/ })).toBeInTheDocument();
  expect(screen.getByText("total").nextElementSibling).toHaveTextContent("775.99");
  expect(screen.getByText(/took 4.0 s · 3 steps · all reused/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
});

test("a run opened on a step shows that step's log", async () => {
  const { calls } = show("#/runs/01M6AAAAAAAAAAAAAAAAAAAAAA/1");
  const logs = await screen.findByRole("log", { name: "log lines" });
  expect(await within(logs).findByText("reading 6 orders")).toBeInTheDocument();
  expect(within(logs).queryByText("one order has no region")).not.toBeInTheDocument();
  expect(calls.getLogs[0]).toMatchObject({ seq: 1 });
});

test("a failed run opens on the failed step's log", async () => {
  const { calls } = show("#/runs/01M6EEEEEEEEEEEEEEEEEEEEEE");
  const logs = await screen.findByRole("log", { name: "log lines" });
  expect(await within(logs).findByText("ValueError: no orders")).toBeInTheDocument();
  expect(within(logs).queryByText("reading 0 orders")).not.toBeInTheDocument();
  expect(calls.getLogs[0]).toMatchObject({ seq: 2 });
  await userEvent.selectOptions(screen.getByLabelText("logs of"), "all steps");
  expect(await within(logs).findByText("reading 0 orders")).toBeInTheDocument();
});

test("a step without reuse= that keeps getting the same result says it may want it", async () => {
  show("#/runs/01M6EEEEEEEEEEEEEEEEEEEEEE");
  const hint = await screen.findByText(/same result as 2 earlier runs with the same code and inputs/);
  expect(hint).toHaveTextContent("it may want reuse=True");
  expect(screen.getAllByText(/may want/)).toHaveLength(1);
});

test("a stuck run can be resumed", async () => {
  const { calls } = show("#/runs/01M6BBBBBBBBBBBBBBBBBBBBBB");
  expect(await screen.findByText(/nondeterminism: time.time\(\) called/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() => expect(calls.resumeRun?.[0]).toMatchObject({ runId: "01M6BBBBBBBBBBBBBBBBBBBBBB" }));
});

test("a run that waits says why, and which workers are connected", async () => {
  const { calls } = show("#/runs/01M6WWWWWWWWWWWWWWWWWWWWWW");
  const why = await screen.findByText(/^Waiting:/);
  expect(why).toHaveTextContent("Waiting: no worker is connected to run the pipeline's code. Deploy its project: moksha dev in its directory, or moksha deploy");
  expect(why.querySelector("code")).toHaveTextContent("moksha dev");
  expect(await screen.findByText("No workers connected.")).toBeInTheDocument();
  const pools = await screen.findAllByText(/^Pool/);
  expect(pools[0]).toHaveTextContent("Pool py (default): 1 of 0–3 workers, 1 starting · started py-1: 1 run waits on default");
  expect(pools[1]).toHaveTextContent("Pool k8s (gpu, started elsewhere): 0 of 0–5 workers, wants 2");
  expect(calls.listWorkers).toBeDefined();
});

test("a run that doesn't wait shows no reason", async () => {
  show("#/runs/01M6AAAAAAAAAAAAAAAAAAAAAA");
  expect(await screen.findByRole("heading", { name: "Daily revenue" })).toBeInTheDocument();
  expect(screen.queryByText(/^Waiting:/)).not.toBeInTheDocument();
});

test("a pipeline: the workers that worked on its runs", async () => {
  const { calls } = show("#/pipelines/daily/workers");
  expect(await screen.findByRole("tab", { selected: true })).toHaveTextContent("Workers");
  const table = await screen.findByRole("table", { name: "pipeline workers" });
  expect(screen.getByText(/workers worked on its last/)).toHaveTextContent(
    "2 workers worked on its last 100 runs (7 step attempts); 0 connected now.",
  );
  const busy = within(table).getByText("host-41").closest("tr")!;
  expect(busy).toHaveTextContent("7 (5 succeeded, 1 failed, 1 lost)");
  expect(busy).toHaveTextContent("2.5 s median, 12 s p95");
  expect(busy).toHaveTextContent("gone");
  const replays = within(table).getByText("host-42").closest("tr")!;
  expect(replays).toHaveTextContent("1 (1 failed)");
  expect(replays).toHaveTextContent("–");
  expect(calls.getPipelineWorkers[0]).toMatchObject({ name: "daily", runs: 100 });
});

test("pipeline tabs have their own URLs; the runs' is the pipeline's", () => {
  expect(parse("#/pipelines/daily/workers")).toEqual({ name: "pipeline", run: "daily", tab: "workers" });
  expect(parse("#/pipelines/daily/runs")).toEqual({ name: "pipeline", run: "daily" });
  expect(parse("#/pipelines/daily/overview")).toEqual({ name: "pipeline", run: "daily" }); // the tab that was: its runs now
  expect(parse("#/pipelines/daily/nope")).toEqual({ name: "pipeline", run: "daily" });
  expect(href({ name: "pipeline", run: "daily", tab: "runs" })).toBe("#/pipelines/daily");
});

test("the sidebar moves between pages; the palette (⌘K) finds a pipeline or run", async () => {
  show("#/groups/revenue");
  const nav = screen.getByRole("navigation", { name: "main" });
  // In a group: a way back, the group, its three places, then what is apart from groups.
  expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["All groups", "Pipelines", "Signals", "Loops", "Runs", "Workers"]);
  expect(nav).toHaveTextContent("revenue");
  expect(within(nav).getByRole("link", { name: "Pipelines" })).toHaveClass("active");
  expect(within(nav).getByRole("link", { name: "Signals" })).toHaveAttribute("href", "#/groups/revenue/signals");
  await userEvent.click(within(nav).getByRole("link", { name: "Runs" }));
  await waitFor(() => expect(window.location.hash).toBe("#/activity"));
  // Apart from any group: only the groups, the runs, the workers.
  await waitFor(() => expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Groups", "Runs", "Workers"]));
  expect(await screen.findByRole("heading", { name: "Runs" })).toBeInTheDocument();
  expect(await screen.findByText("hourly")).toBeInTheDocument(); // every pipeline's runs

  await userEvent.keyboard("{Meta>}k{/Meta}");
  const dialog = await screen.findByRole("dialog", { name: "search" });
  await userEvent.type(within(dialog).getByRole("combobox", { name: "search pipelines and runs" }), "daily 10-23");
  await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
  expect(within(dialog).getByRole("option", { selected: true })).toHaveTextContent("Daily revenue · day 2026-10-23completed");
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(window.location.hash).toBe("#/runs/01M6DDDDDDDDDDDDDDDDDDDDDD"));
  expect(screen.queryByRole("dialog", { name: "search" })).not.toBeInTheDocument();

  await userEvent.keyboard("{Control>}k{/Control}");
  const again = await screen.findByRole("dialog", { name: "search" });
  await userEvent.type(within(again).getByRole("combobox"), "work");
  expect(within(again).getAllByRole("option").map((o) => o.textContent)).toEqual(["Workers"]);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "search" })).not.toBeInTheDocument();
});

test("a run says which steps are checkpointed: saved in its event log, so a restart won't run them again", async () => {
  show("#/runs/01M6AAAAAAAAAAAAAAAAAAAAAA");
  const summary = await screen.findByRole("status", { name: "durability" });
  expect(summary).toHaveTextContent("2 of 3 steps checkpointed");
  expect(summary).toHaveTextContent("If the server or a worker stops now, these stay done and the run picks up from here; the others run again.");
  expect([...summary.querySelectorAll(".durability-bar i")].map((i) => i.className)).toEqual(["saved", "saved", "running"]);

  // On the graph: a marker on each checkpointed step.
  const graph = screen.getByRole("list", { name: "steps graph" });
  const marked = within(graph).getAllByRole("listitem").map((n) => n.querySelector(".dag-saved") !== null);
  expect(marked).toEqual([true, true, false]);

  // In the steps table: when each was saved, or what a restart would do.
  const table = screen.getAllByRole("table")[0];
  expect(within(table).getByText("extract").closest("tr")!.querySelector(".checkpoint")).toHaveTextContent("saved");
  expect(within(table).getByText("report").closest("tr")!.querySelector(".checkpoint")).toHaveTextContent(
    "running: if its worker or the server stops, it runs again",
  );
});

test("a finished run is checkpointed throughout", async () => {
  show("#/runs/01M6EEEEEEEEEEEEEEEEEEEEEE");
  const summary = await screen.findByRole("status", { name: "durability" });
  expect(summary).toHaveTextContent("2 of 2 steps checkpointed");
  expect(summary).toHaveTextContent("How each step ended is saved in the run's event log.");
});

function threeKinds(): World {
  return {
    loops: ["watch", "idle"],
    runs: [
      run("01M7CLOSEDCLOSEDCLOSED0001", "close", "completed", { finishedAt: at(5) }),
      run("01M7PARKEDPARKEDPARKED0001", "gate", "running", {
        paramsJson: '{"day":"2026-10-26"}',
        stepCounts: { total: 4, completed: 4 },
        signalWaits: [{ seq: 5, name: "approve" }],
      }),
      run("01M7ATW0RKATW0RKATW0RK0001", "mixed", "running", {
        stepCounts: { total: 2, completed: 1 },
        signalWaits: [{ seq: 3, name: "file_arrived" }],
      }),
      run("01M7L00PL00PL00PL00P000002", "watch", "running", { trigger: "continue 01M7L00PL00PL00PL00P000001", signalWaits: [{ seq: 2, name: "stop" }] }),
      run("01M7L00PL00PL00PL00P000001", "watch", "continued", { trigger: "the CLI", finishedAt: at(60) }),
    ],
  };
}

test("the Pipelines page has neither loops nor runs parked on a signal", async () => {
  show("#/groups/~", threeKinds());
  const table = await screen.findByRole("table");
  expect(within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("a")!.textContent)).toEqual(["close", "gate", "mixed"]);
  expect(within(table).queryByText("watch")).not.toBeInTheDocument();
  const gate = within(table).getByRole("link", { name: "gate" }).closest("tr")!;
  expect(gate).not.toHaveTextContent("running");
  expect(gate).not.toHaveTextContent("never ran");
  // One that waits with a step still running is at work.
  expect(within(table).getByRole("link", { name: "mixed" }).closest("tr")).toHaveTextContent("running");
  expect(screen.getByText("running now").nextElementSibling).toHaveTextContent("1");
});

test("Signals: what waits, by signal, answered in place; not what loops listen for", async () => {
  const { calls } = show("#/groups/~/signals", threeKinds());
  const approve = await screen.findByRole("region", { name: "signal approve" });
  expect(approve).toHaveTextContent("2026-10-26");
  expect(approve).toHaveTextContent("waits as long as it takes");
  expect(screen.getByRole("region", { name: "signal file_arrived" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "signal stop" })).not.toBeInTheDocument();

  const payload = within(approve).getByLabelText("approve payload");
  await userEvent.type(payload, "nope");
  await userEvent.click(within(approve).getByRole("button", { name: "Send approve" }));
  expect(await within(approve).findByText(/must be JSON/)).toBeInTheDocument();
  expect(calls.signalRun).toBeUndefined();

  await userEvent.clear(payload);
  await userEvent.type(payload, '{{"by":"ana"}');
  await userEvent.click(within(approve).getByRole("button", { name: "Send approve" }));
  await waitFor(() =>
    expect(calls.signalRun[0]).toMatchObject({ runId: "01M7PARKEDPARKEDPARKED0001", name: "approve", payloadJson: '{"by":"ana"}' }),
  );
});

test("Loops: a chain of runs as one, signalled in the run it is in now", async () => {
  const { calls } = show("#/groups/~/loops", threeKinds());
  const watch = await screen.findByRole("listitem", { name: "loop watch" });
  expect(within(watch).getByText("runs so far").nextElementSibling).toHaveTextContent(/^2$/);
  expect(screen.getByRole("listitem", { name: "loop idle" })).toHaveTextContent("never started");
  expect(screen.queryByRole("listitem", { name: "loop gate" })).not.toBeInTheDocument();
  await userEvent.click(within(watch).getByRole("button", { name: "Send stop" }));
  await waitFor(() => expect(calls.signalRun[0]).toMatchObject({ runId: "01M7L00PL00PL00PL00P000002", name: "stop" }));
});

test("a loop whose start is older than the runs loaded says at least", async () => {
  const world = threeKinds();
  world.runs = world.runs.filter((h) => h.status !== "continued");
  show("#/groups/~/loops", world);
  const watch = await screen.findByRole("listitem", { name: "loop watch" });
  expect(within(watch).getByText("runs so far").nextElementSibling).toHaveTextContent("at least 1");
});

test("a loop's own page belongs under Loops", async () => {
  show("#/pipelines/watch", threeKinds());
  const nav = screen.getByRole("navigation", { name: "main" });
  await waitFor(() => expect(within(nav).getByRole("link", { name: /^Loops/ })).toHaveClass("active"));
  expect(within(nav).getByRole("link", { name: /^Pipelines/ })).not.toHaveClass("active");
});

function grouped(): World {
  return {
    loops: ["watch"],
    groups: { close: "shop", month: "shop", watch: "shop", rates: "finance" },
    projects: { books: ["close", "month", "watch", "rates", "alone"] },
    runs: [
      run("01M8CLOSEDCLOSEDCLOSED0001", "close", "failed", { finishedAt: at(5), reason: "StepFailed" }),
      run("01M8M0NTHM0NTHM0NTHM0N0001", "month", "completed", { finishedAt: at(9) }),
      run("01M8RATESRATESRATESRATE001", "rates", "completed", { finishedAt: at(2) }),
      run("01M8ALONEALONEALONEAL00001", "alone", "completed", { finishedAt: at(1) }),
    ],
  };
}

test("home: a card per group, saying what goes on there, with a door into each kind of its work", async () => {
  show("#/", grouped());
  const shop = await screen.findByRole("listitem", { name: "group shop" });
  // By name, the pipelines that name no group last.
  expect(screen.getAllByRole("listitem", { name: /^group / }).map((c) => c.getAttribute("aria-label"))).toEqual([
    "group finance", "group shop", "group Not in a group",
  ]);
  expect(shop).toHaveTextContent("project books v3 · deployed"); // which project deployed it: a detail
  await waitFor(() => expect(shop).toHaveTextContent("needs a look"));
  const doors = within(shop).getByRole("navigation", { name: "into shop" });
  expect(within(doors).getAllByRole("link").map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")])).toEqual([
    ["Pipelines: 2", "#/groups/shop"],
    ["Signals: 0", "#/groups/shop/signals"],
    ["Loops: 1", "#/groups/shop/loops"],
  ]);
  expect(within(doors).getByRole("link", { name: "Pipelines: 2" })).toHaveTextContent("1 failed last time");
  expect(screen.getByRole("listitem", { name: "group finance" })).toHaveTextContent("quiet");
  // What needs you comes first, as a way straight to it.
  const needs = screen.getByRole("list", { name: "needs you" });
  expect(within(needs).getByRole("link")).toHaveAttribute("href", "#/groups/shop");
  // Home has no pipelines, signals or loops of its own.
  expect(screen.queryByRole("table")).not.toBeInTheDocument();

  await userEvent.click(shop);
  await waitFor(() => expect(window.location.hash).toBe("#/groups/shop"));
  const table = await screen.findByRole("table");
  expect(within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("a")!.textContent)).toEqual(["close", "month"]);
  expect(screen.getByRole("navigation", { name: "breadcrumb" })).toHaveTextContent("GroupsshopPipelines");
});

test("a group's pipeline and its runs stay in the group: crumbs and sidebar", async () => {
  show("#/pipelines/close", grouped());
  const crumbs = await screen.findByRole("navigation", { name: "breadcrumb" });
  await waitFor(() => expect(within(crumbs).getByRole("link", { name: "shop" })).toHaveAttribute("href", "#/groups/shop"));
  const nav = screen.getByRole("navigation", { name: "main" });
  expect(nav).toHaveTextContent("shop");
  expect(within(nav).getByRole("link", { name: "Pipelines" })).toHaveClass("active");
  expect(parse("#/groups/a%2Fb/loops")).toEqual({ name: "loops", group: "a/b" });
  expect(href({ name: "signals", group: "a/b" })).toBe("#/groups/a%2Fb/signals");
});

test("pipelines that name no group have a card of their own on home", async () => {
  show("#/", threeKinds());
  const loose = await screen.findByRole("listitem", { name: "group Not in a group" });
  expect(loose).toHaveTextContent("no project deployed it");
  expect(within(loose).getByRole("link", { name: /^Pipelines/ })).toHaveAttribute("href", "#/groups/~");
  expect(parse("#/runs")).toEqual({ name: "home" }); // the old start page's URL lands home
});
