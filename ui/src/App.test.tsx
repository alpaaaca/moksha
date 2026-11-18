import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { createRouterTransport } from "@connectrpc/connect";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiProvider, apiFor } from "./api";
import { App } from "./App";
import { href, parse } from "./router";
import { RunSchema, RunService, StepCountsSchema, StepSchema } from "./gen/moksha/v1/run_pb";
import { LogService } from "./gen/moksha/v1/log_pb";

const start = new Date(2026, 9, 24, 3, 0, 0);
const at = (seconds: number) => timestampFromDate(new Date(start.getTime() + seconds * 1000));
const t0 = at(0);

function run(id: string, name: string, status: string, extra: MessageInitShape<typeof RunSchema> = {}) {
  return create(RunSchema, { id, tenant: "default", name, status, createdAt: t0, ...extra });
}

// A RunService in memory, recording what the UI asked.
function fakeServer() {
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
        const all = [daily, done, stuck, broken];
        return { runs: all.filter((h) => (!req.name || h.name === req.name) && (!req.statuses.length || req.statuses.includes(h.status))) };
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
        return { pipelines: [{ name: "daily", title: "Daily revenue", description: "Orders to a report, per day." }, { name: "hourly" }] };
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
    service(LogService, {
      getLogs(req) {
        record("getLogs", req);
        return { lines: (runLogs[req.runId] ?? []).filter((l) => !req.seq || l.seq === req.seq) };
      },
    });
  });
  return { api: apiFor(transport), calls };
}

function show(hash: string) {
  window.location.hash = hash;
  const server = fakeServer();
  render(
    <ApiProvider api={server.api}>
      <App />
    </ApiProvider>,
  );
  return server;
}

test("the start page: each pipeline's meta information, not its runs", async () => {
  show("#/runs");
  const table = await screen.findByRole("table");
  const daily = (await within(table).findByRole("link", { name: "Daily revenue" })).closest("tr")!;
  expect(daily).toHaveTextContent("Orders to a report, per day.");
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

test("a pipeline: its recent runs told by their data", async () => {
  const { calls } = show("#/pipelines/daily");
  expect(await screen.findByRole("heading", { name: "Daily revenue" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "breadcrumb" })).toHaveTextContent("PipelinesDaily revenue");
  expect(screen.getByText(/on a schedule/)).toHaveTextContent("0 3 * * * (Europe/Berlin), daily data");
  expect(screen.getByText("next run").nextElementSibling).toHaveTextContent("in 5 h");

  // A run each, newest first: what it wrote and reused, what failed or still runs.
  const feed = await screen.findByRole("list", { name: "recent runs" });
  const runs = within(feed).getAllByRole("link");
  expect(runs.map((r) => r.getAttribute("aria-label"))).toEqual([
    "run of day 2026-10-24: running", "run of day 2026-10-23: completed", "run of day 2026-10-22: failed",
  ]);
  const chips = (r: HTMLElement) => [...r.querySelectorAll(".chip")].map((c) => `${c.className.replace("chip ", "")} ${c.textContent}`);
  expect(chips(runs[0])).toEqual(["wrote raw.orders", "reused mart.revenue", "busy report"]);
  expect(chips(runs[1])).toEqual([]);
  expect(runs[1]).toHaveTextContent("3 steps · all reused");
  expect(chips(runs[2])).toEqual(["failed build failed"]);
  expect(calls.listRuns.find((r) => (r as { withSteps?: boolean }).withSteps)).toMatchObject({ name: "daily", withSteps: true });
  // A run opens.
  await userEvent.click(runs[2]);
  await waitFor(() => expect(window.location.hash).toBe("#/runs/01M6EEEEEEEEEEEEEEEEEEEEEE"));
});

test("a pipeline: its steps as a graph, all its runs, starting one; a tab each", async () => {
  const { calls } = show("#/pipelines/daily");
  const graph = await screen.findByRole("list", { name: "steps graph" });
  expect(within(graph).getAllByRole("listitem").map((n) => n.textContent)).toEqual(["extractraw.orders", "buildmart.revenue", "report"]);
  expect(within(graph).getByTitle("writes raw.orders")).toHaveTextContent("raw.orders");
  const tabs = screen.getByRole("tablist", { name: "pipeline" });
  expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Runs", "Workers", "Start a run"]);
  expect(within(tabs).getByRole("tab", { selected: true })).toHaveTextContent("Overview");
  // Other tabs' content isn't there, nor asked for.
  expect(screen.queryByLabelText("inputs")).not.toBeInTheDocument();
  expect(calls.getPipelineWorkers).toBeUndefined();

  await userEvent.click(within(tabs).getByRole("tab", { name: "Runs" }));
  await waitFor(() => expect(window.location.hash).toBe("#/pipelines/daily/runs"));
  const panel = screen.getByRole("tabpanel", { name: "Runs" });
  const runs = await within(panel).findByRole("table");
  expect(within(runs).getByText("2026-10-23").closest("tr")).toHaveTextContent("3 steps · all reused");
  expect(screen.queryByRole("list", { name: "steps graph" })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("status"), "completed");
  await waitFor(() => expect(within(within(panel).getByRole("table")).queryByText("2026-10-24")).not.toBeInTheDocument());
  expect(calls.listRuns.at(-1)).toMatchObject({ name: "daily", statuses: ["completed"] });

  // Starting a run: the inputs start as the latest run's.
  await userEvent.click(within(tabs).getByRole("tab", { name: "Start a run" }));
  await waitFor(() => expect(window.location.hash).toBe("#/pipelines/daily/start"));
  const params = await screen.findByLabelText("inputs");
  await waitFor(() => expect(params).toHaveValue('{"day":"2026-10-24"}'));
  await userEvent.clear(params);
  await userEvent.type(params, "not json");
  await userEvent.click(screen.getByRole("button", { name: "Start a run" }));
  expect(await screen.findByText(/inputs must be JSON/)).toBeInTheDocument();
  expect(calls.startRun).toBeUndefined();

  await userEvent.clear(params);
  await userEvent.type(params, '{{"day": "2026-10-25"}');
  await userEvent.click(screen.getByRole("button", { name: "Start a run" }));
  await waitFor(() => expect(window.location.hash).toBe("#/runs/01M6AAAAAAAAAAAAAAAAAAAAAA"));
  expect(calls.startRun[0]).toMatchObject({ name: "daily", paramsJson: '{"day": "2026-10-25"}', trigger: "the web UI" });
});

test("a scheduled pipeline starts by hand with the latest interval as its inputs", async () => {
  show("#/pipelines/nightly/start");
  await waitFor(() => expect(screen.getByLabelText("inputs")).toHaveValue('{"interval":{"$interval":{"end":"2026-10-24T13:00:00Z","start":"2026-10-24T12:00:00Z"}}}'));
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
  expect(calls.listRuns[0]).toMatchObject({ parentId: "01M6AAAAAAAAAAAAAAAAAAAAAA" });

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

test("pipeline tabs have their own URLs; the overview's is the pipeline's", () => {
  expect(parse("#/pipelines/daily/workers")).toEqual({ name: "pipeline", run: "daily", tab: "workers" });
  expect(parse("#/pipelines/daily/overview")).toEqual({ name: "pipeline", run: "daily" });
  expect(parse("#/pipelines/daily/nope")).toEqual({ name: "pipeline", run: "daily" });
  expect(href({ name: "pipeline", run: "daily", tab: "runs" })).toBe("#/pipelines/daily/runs");
  expect(href({ name: "pipeline", run: "daily", tab: "overview" })).toBe("#/pipelines/daily");
});

test("the sidebar moves between pages; the palette (⌘K) finds a pipeline or run", async () => {
  show("#/runs");
  const nav = screen.getByRole("navigation", { name: "main" });
  expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Pipelines", "Runs", "Workers"]);
  expect(within(nav).getByRole("link", { name: "Pipelines" })).toHaveClass("active");
  await userEvent.click(within(nav).getByRole("link", { name: "Runs" }));
  await waitFor(() => expect(window.location.hash).toBe("#/activity"));
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
