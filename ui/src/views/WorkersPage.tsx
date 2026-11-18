import { Workers } from "./Waiting";

// WorkersPage: the worker pools and the workers connected now.
export function WorkersPage() {
  return (
    <section>
      <div className="page-head">
        <h1>Workers</h1>
      </div>
      <p className="lede">The processes that run your pipelines and steps, connected now, and the pools that start them.</p>
      <Workers />
    </section>
  );
}
