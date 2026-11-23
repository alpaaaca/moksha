import { ago, duration, Status, took, when } from "../format";
import { Icon } from "../icons";
import { broken, useLoopRuns, type Chain, type Loop } from "../loops";
import { usePipelines, type Pipelines } from "../pipelines";
import { Link } from "../router";
import { Hint } from "../words";
import { SendSignal } from "./SendSignal";

// Loops: the pipelines that run until stopped, each chain of runs told as
// the one long-living thing it is.
export function Loops() {
  const pipelines = usePipelines();
  const { loaded, loops, error, reload } = useLoopRuns();
  const all = loops(pipelines.loops);
  const ready = loaded && pipelines.loaded;

  return (
    <section>
      <div className="page-head">
        <h1>Loops</h1>
        <Hint word="loop" />
      </div>
      <p className="lede">What keeps running until it is stopped.</p>
      {error && <p className="error">{error}</p>}
      {!ready && !error && <p className="dim">loading…</p>}
      {ready && all.length === 0 && (
        <p className="empty">
          No loops. A pipeline that calls <code>ctx.continue_as_new</code> is one.
        </p>
      )}
      {ready && all.length > 0 && (
        <ul className="cards">
          {all.map((l) => (
            <LoopCard key={l.name} loop={l} pipelines={pipelines} onSent={reload} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LoopCard({ loop: l, pipelines, onSent }: { loop: Loop; pipelines: Pipelines; onSent: () => void }) {
  const info = pipelines.info(l.name);
  const state = broken(l) ? "broken" : l.live.length ? "live" : "off";
  return (
    <li className={`card loop is-${state}`} aria-label={`loop ${pipelines.title(l.name)}`}>
      <div className="card-head">
        <Icon name="loops" size={20} />
        <Link to={{ name: "pipeline", run: l.name }} className="card-title">
          {pipelines.title(l.name)}
        </Link>
        {info?.title && <span className="mono dim small">{l.name}</span>}
        <span className="card-aside">{state === "broken" ? "needs a look" : state === "live" ? "looping" : "not running"}</span>
      </div>
      {info?.description && <p className="dim">{info.description}</p>}
      {l.live.map((c) => (
        <Live key={c.first.id} chain={c} onSent={onSent} />
      ))}
      {l.live.length === 0 && (
        <p className="loop-rest small">
          {l.last ? (
            <>
              <Link to={{ name: "run", id: l.last.id }}>
                <Status status={l.last.status} />
              </Link>
              <span className="dim" title={when(l.last.finishedAt)}>
                {ago(l.last.finishedAt)}
              </span>
              {l.last.status === "failed" && <span className="error">{l.last.message || l.last.reason}</span>}
            </>
          ) : (
            <span className="dim">never started</span>
          )}
          <Link to={{ name: "pipeline", run: l.name, tab: "start" }}>Start it</Link>
        </p>
      )}
    </li>
  );
}

function Live({ chain: { now, first, runs, whole }, onSent }: { chain: Chain; onSent: () => void }) {
  const least = whole ? "" : "at least ";
  const names = [...new Set(now.signalWaits.map((w) => w.name))];
  return (
    <div className="loop-live">
      <dl className="loop-facts">
        <div>
          <dt>going for</dt>
          <dd title={`since ${when(first.createdAt)}`}>
            {least}
            {duration(took(first.createdAt) ?? 0)}
          </dd>
        </div>
        <div>
          <dt>runs so far</dt>
          <dd>
            {least}
            {runs}
          </dd>
        </div>
        <div>
          <dt>now in</dt>
          <dd>
            <Link to={{ name: "run", id: now.id }}>this run</Link>
          </dd>
        </div>
        <div>
          <dt>listens for</dt>
          <dd>{names.length ? names.join(", ") : <span className="dim">nothing right now</span>}</dd>
        </div>
      </dl>
      {now.status === "stuck" && <p className="error small">{now.message || now.reason}</p>}
      {names.map((name) => (
        <SendSignal key={name} runId={now.id} name={name} onSent={onSent} />
      ))}
    </div>
  );
}
