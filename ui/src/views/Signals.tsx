import { ago, fromNow, steps, Values, when } from "../format";
import { Icon } from "../icons";
import { usePipelines } from "../pipelines";
import { Link } from "../router";
import { useSignalWaits, type Wait } from "../waits";
import { Hint } from "../words";
import { SendSignal } from "./SendSignal";

// Signals: what waits for someone or something outside, by the signal it
// waits for, each with the form that answers it.
export function Signals() {
  const pipelines = usePipelines();
  const { waits, error, reload } = useSignalWaits();
  const byName = new Map<string, Wait[]>();
  for (const w of waits ?? []) byName.set(w.wait.name, [...(byName.get(w.wait.name) ?? []), w]);

  return (
    <section>
      <div className="page-head">
        <h1>Signals</h1>
        <Hint word="signal" />
      </div>
      <p className="lede">Work paused until someone, or something outside, answers.</p>
      {error && <p className="error">{error}</p>}
      {!waits && !error && <p className="dim">loading…</p>}
      {waits?.length === 0 && <p className="empty">Nothing waits for a signal.</p>}
      {[...byName].map(([name, ws]) => (
        <section key={name} className="signal" aria-label={`signal ${name}`}>
          <h2>
            <span className="signal-name">{name}</span>
            {ws.length} waiting
          </h2>
          <ul className="cards">
            {ws.map(({ run, wait }) => (
              <li key={`${run.id}:${wait.seq}`} className="card asks">
                <div className="card-head">
                  <Icon name="signals" />
                  <Link to={{ name: "run", id: run.id }} className="card-title">
                    {pipelines.title(run.name)}
                  </Link>
                  <Values json={run.paramsJson} />
                  <span className="card-aside" title={wait.timesOutAt && when(wait.timesOutAt)}>
                    {wait.timesOutAt ? `times out ${fromNow(wait.timesOutAt)}` : "waits as long as it takes"}
                  </span>
                </div>
                <p className="dim small">
                  <span title={when(run.createdAt)}>started {ago(run.createdAt)}</span> · {steps(run)}
                </p>
                <SendSignal runId={run.id} name={name} onSent={reload} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
