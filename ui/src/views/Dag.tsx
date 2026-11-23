import type { Step } from "../gen/moksha/v1/run_pb";
import { checkpointed, clock, duration, stepStatus, Status, took } from "../format";
import { Icon } from "../icons";

const W = 220; // node width
const H = 84; // node height
const GX = 72; // gap between columns
const GY = 20; // gap between rows

type Node = { key: string; name: string; col: number; row: number; steps: Step[]; dataset: string };

// layout puts each step in the column after the steps it reads from, and
// folds steps of one name in one column into one node (a fan-out of 100
// extracts is one box, "100 ×").
export function layout(steps: Step[]): { nodes: Node[]; edges: [Node, Node][] } {
  const col = new Map<number, number>(); // seq → column
  const nodeOf = new Map<number, Node>(); // seq → node
  const nodes: Node[] = [];
  const rows: number[] = [];
  for (const l of [...steps].sort((a, b) => a.seq - b.seq)) {
    const known = l.after.filter((a) => col.has(a)); // data versions from outside the run start a column
    const c = known.length ? Math.max(...known.map((a) => col.get(a)! + 1)) : 0;
    col.set(l.seq, c);
    const key = `${c}:${l.name}`;
    let n = nodes.find((x) => x.key === key);
    if (!n) {
      n = { key, name: l.name, col: c, row: rows[c] ?? 0, steps: [], dataset: l.dataset };
      rows[c] = n.row + 1;
      nodes.push(n);
    }
    n.steps.push(l);
    nodeOf.set(l.seq, n);
  }
  const edges: [Node, Node][] = [];
  const seen = new Set<string>();
  for (const l of steps) {
    for (const a of l.after) {
      const from = nodeOf.get(a);
      const to = nodeOf.get(l.seq)!;
      if (from && from !== to && !seen.has(from.key + ">" + to.key)) {
        seen.add(from.key + ">" + to.key);
        edges.push([from, to]);
      }
    }
  }
  return { nodes, edges };
}

// groupStatus is a node's status: the worst of its steps', or how far along they are.
function groupStatus(steps: Step[]): string {
  const ss = steps.map(stepStatus);
  for (const s of ["failed", "cancelled", "retrying", "running", "waiting"]) if (ss.includes(s)) return s;
  return ss.every((s) => s === "reused") ? "reused" : "completed";
}

// Dag draws a run's steps as cards in columns on a canvas, with curves from
// the steps whose data versions each one reads. plain: no statuses (a
// pipeline's steps rather than a run's).
export function Dag({
  steps,
  now,
  plain = false,
  selected = 0,
  onSelect,
}: {
  steps: Step[];
  now: number;
  plain?: boolean;
  selected?: number; // a step's seq, to mark its node
  onSelect?: (seq: number) => void; // clicking a node picks its (first) step
}) {
  const { nodes, edges } = layout(steps);
  const status = new Map(nodes.map((n) => [n.key, plain ? "plain" : groupStatus(n.steps)]));
  const cols = Math.max(...nodes.map((n) => n.col)) + 1;
  const rows = Math.max(...nodes.map((n) => n.row)) + 1;
  const width = cols * W + (cols - 1) * GX;
  const height = rows * H + (rows - 1) * GY;
  const x = (n: Node) => n.col * (W + GX);
  const y = (n: Node) => n.row * (H + GY);
  return (
    <div className="dag-canvas">
      <div className="dag" style={{ width, height }} role="list" aria-label="steps graph">
        <svg width={width} height={height} aria-hidden="true">
          {edges.map(([a, b]) => {
            const x1 = x(a) + W;
            const y1 = y(a) + H / 2;
            const x2 = x(b);
            const y2 = y(b) + H / 2;
            const mid = (x1 + x2) / 2;
            const to = status.get(b.key);
            return (
              <g key={a.key + ">" + b.key} className={`dag-edge edge-${to}`}>
                <path d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} />
                <circle cx={x1} cy={y1} r="3.5" />
                <circle cx={x2} cy={y2} r="3.5" />
              </g>
            );
          })}
        </svg>
        {nodes.map((n) => {
          const st = status.get(n.key)!;
          const one = n.steps.length === 1 ? n.steps[0] : undefined;
          const done = n.steps.filter((l) => l.status === "completed").length;
          const t = one && took(one.scheduledAt, one.finishedAt, now);
          const cls = [
            "dag-node",
            `node-${st}`,
            n.steps.length > 1 && "stacked",
            onSelect && "clickable",
            n.steps.some((l) => l.seq === selected) && "selected",
          ].filter(Boolean);
          return (
            <div
              key={n.key}
              role="listitem"
              className={cls.join(" ")}
              style={{ left: x(n), top: y(n), width: W, height: H }}
              onClick={onSelect && (() => onSelect(n.steps[0].seq))}
              title={onSelect ? "show its logs" : undefined}
            >
              <div className="dag-badge" title={plain ? "step" : st}>
                <Icon name={plain ? "step" : st} />
              </div>
              <div className="dag-body">
                <div className="dag-name" title={n.name}>
                  {n.name}
                </div>
                {!plain && (
                  <div className="dag-meta">
                    <Status status={st} />
                    <span className="dim small">{one ? (t === undefined ? "" : duration(t)) : `${done} of ${n.steps.length} done`}</span>
                  </div>
                )}
                {n.dataset && (
                  <div className="dag-dataset" title={`writes ${n.dataset}`}>
                    <Icon name="dataset" size={12} />
                    <span>{n.dataset}</span>
                  </div>
                )}
              </div>
              {!plain && <Saved steps={n.steps} />}
              {n.steps.length > 1 && (
                <span className="dag-count" title={`${n.steps.length} steps of this name`}>
                  ×{n.steps.length}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Saved marks a node whose steps are checkpointed: how they ended is in the
// run's event log, so they won't run again in this run. A fan-out says how
// many of its steps are.
function Saved({ steps }: { steps: Step[] }) {
  const saved = steps.filter(checkpointed);
  if (saved.length === 0) return null;
  const all = saved.length === steps.length;
  const title =
    steps.length === 1
      ? `checkpointed at ${clock(steps[0].finishedAt)} UTC: saved in the run's event log, it won't run again in this run`
      : `${saved.length} of ${steps.length} checkpointed: saved in the run's event log, they won't run again in this run`;
  return (
    <span className={`dag-saved${all ? "" : " partial"}`} title={title} aria-label={title}>
      <Icon name="saved" size={12} />
    </span>
  );
}
