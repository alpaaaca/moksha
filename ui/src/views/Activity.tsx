import { useState } from "react";

import { useApi } from "../api";
import { usePoll } from "../hooks";
import { usePipelines } from "../pipelines";
import { RunsTable, StatusFilter } from "./RunList";

// Activity: every pipeline's runs, newest first.
export function Activity() {
  const api = useApi();
  const pipelines = usePipelines();
  const [status, setStatus] = useState("");
  const runs = usePoll(() => api.runs.listRuns({ statuses: status ? [status] : [], limit: 100 }), [status]);
  return (
    <section>
      <div className="page-head">
        <h1>Runs</h1>
        <StatusFilter value={status} onChange={setStatus} />
      </div>
      <p className="lede">Every pipeline's runs, newest first.</p>
      {runs.error && <p className="error">{runs.error}</p>}
      {runs.data ? <RunsTable runs={runs.data.runs} pipelines={pipelines} /> : !runs.error && <p className="dim">loading…</p>}
    </section>
  );
}
