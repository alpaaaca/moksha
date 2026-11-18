import type { Run, Step } from "../gen/moksha/v1/run_pb";
import { ago, duration, inputsText, Status, stepStatus, steps as stepSummary, took, Values, when } from "../format";
import { Icon } from "../icons";
import { Link } from "../router";

// RunFeed: a pipeline's recent runs, newest first, each told by its data:
// the datasets it wrote and those it reused, with how long it took next to
// the others. A failed or running step says so.
export function RunFeed({ runs, now }: { runs: Run[]; now: number }) {
  const times = runs.map((h) => took(h.createdAt, h.finishedAt, now) ?? 0);
  const longest = Math.max(...times, 1);
  return (
    <ul className="feed" aria-label="recent runs">
      {runs.map((h, i) => (
        <li key={h.id}>
          <Link to={{ name: "run", id: h.id }} className={`feed-run feed-${h.status}`} label={`run of ${inputsText(h)}: ${h.status}`}>
            <div className="feed-main">
              <Status status={h.status} />
              <span className="feed-inputs">
                <Values json={h.paramsJson} empty="no inputs" />
              </span>
              <span className="feed-bar" aria-hidden="true">
                <i style={{ width: `${Math.max((times[i] / longest) * 100, 2)}%` }} />
              </span>
              <span className="feed-took">{h.finishedAt || h.status === "running" ? duration(times[i]) : "–"}</span>
              <span className="feed-when" title={when(h.createdAt)}>
                {ago(h.createdAt, now)}
              </span>
            </div>
            <Data run={h} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Data is what a run did with data, in chips: datasets written, reused, and
// the steps that failed or still run.
function Data({ run: h }: { run: Run }) {
  const wrote = unique(h.steps.filter((l) => l.dataset && !l.reused && l.status === "completed"));
  const reused = unique(h.steps.filter((l) => l.dataset && l.reused));
  const failed = h.steps.filter((l) => l.status === "failed");
  const busy = h.steps.filter((l) => ["running", "waiting", "retrying"].includes(stepStatus(l)));
  const chips = wrote.length + reused.length + failed.length + busy.length;
  return (
    <div className="feed-data">
      {wrote.map((d) => (
        <span key={`w${d}`} className="chip wrote" title={`wrote a new version of ${d}`}>
          <Icon name="dataset" size={12} />
          {d}
        </span>
      ))}
      {reused.map((d) => (
        <span key={`r${d}`} className="chip reused" title={`reused a version of ${d}`}>
          <Icon name="reused" size={12} />
          {d}
        </span>
      ))}
      {failed.map((l) => (
        <span key={`f${l.seq}`} className="chip failed" title={l.message || l.reason}>
          <Icon name="failed" size={12} />
          {l.name} failed
        </span>
      ))}
      {unique(busy, (l) => l.name).map((name) => (
        <span key={`b${name}`} className="chip busy">
          <Icon name="running" size={12} />
          {name}
        </span>
      ))}
      {chips === 0 && <span className="dim small">{stepSummary(h)}</span>}
      {h.status === "failed" && failed.length === 0 && (h.message || h.reason) && (
        <span className="chip failed">{h.message || h.reason}</span>
      )}
    </div>
  );
}

function unique(steps: Step[], key: (l: Step) => string = (l) => l.dataset): string[] {
  return [...new Set(steps.map(key))];
}
