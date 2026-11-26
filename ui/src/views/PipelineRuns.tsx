import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { useState } from "react";

import { useApi } from "../api";
import { ms } from "../format";
import type { Run } from "../gen/moksha/v1/run_pb";
import { usePoll } from "../hooks";
import { Icon } from "../icons";
import { RunsTable, StatusFilter } from "./RunList";

const NEWEST = 100;
const DAY_LIMIT = 1000;
const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// A day as the date input has it (YYYY-MM-DD), in UTC like every time here.
export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

// PipelineRuns: a pipeline's runs, newest first. Narrowed to a day (UTC),
// they come with the day's runs by hour, and an hour picked there (or in
// its list) narrows them further. The server narrows by day; the hours are
// counted from the day's runs.
export function PipelineRuns({ run }: { run: string }) {
  const api = useApi();
  const [status, setStatus] = useState("");
  const [day, setDay] = useState("");
  const [hour, setHour] = useState<number>();
  const from = day ? dayStart(day) : undefined;
  const runs = usePoll(
    () =>
      api.runs.listRuns({
        name: run,
        statuses: status ? [status] : [],
        limit: from === undefined ? NEWEST : DAY_LIMIT,
        ...(from === undefined ? {} : { createdAfter: timestampFromDate(new Date(from)), createdBefore: timestampFromDate(new Date(from + DAY_MS)) }),
      }),
    [run, status, from],
    from === undefined ? undefined : 5000,
  );
  const all = runs.data?.runs ?? [];
  const shown = from === undefined || hour === undefined ? all : all.filter((h) => inHour(h, from, hour));
  const pickDay = (d: string) => {
    setDay(d);
    setHour(undefined);
  };
  const step = (by: number) => pickDay(utcDay((from ?? dayStart(utcDay(Date.now()))) + by * DAY_MS));
  const today = utcDay(Date.now());

  return (
    <>
      <div className="toolbar run-filters">
        <StatusFilter value={status} onChange={setStatus} />
        <span className="day-picker">
          <button type="button" className="icon-button" aria-label="day before" onClick={() => step(-1)}>
            <Icon name="chevron-left" size={13} />
          </button>
          <input type="date" aria-label="day (UTC)" value={day} max={today} onChange={(e) => pickDay(e.target.value)} />
          <button type="button" className="icon-button" aria-label="day after" onClick={() => step(1)} disabled={!day || day >= today}>
            <Icon name="chevron" size={13} />
          </button>
        </span>
        <select aria-label="hour (UTC)" value={hour ?? ""} disabled={!day} onChange={(e) => setHour(e.target.value === "" ? undefined : Number(e.target.value))}>
          <option value="">any hour</option>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {hh(h)}–{hh(h + 1)}
            </option>
          ))}
        </select>
        <span className="quick-days">
          <button type="button" className={`link-button${day === today ? " on" : ""}`} onClick={() => pickDay(today)}>
            Today
          </button>
          <button type="button" className={`link-button${day === utcDay(Date.now() - DAY_MS) ? " on" : ""}`} onClick={() => pickDay(utcDay(Date.now() - DAY_MS))}>
            Yesterday
          </button>
          {day && (
            <button type="button" className="link-button" onClick={() => pickDay("")}>
              Any day
            </button>
          )}
        </span>
        <span className="dim small filter-note">
          {from === undefined
            ? `the newest ${NEWEST}`
            : `${shown.length} ${shown.length === 1 ? "run" : "runs"}${hour === undefined ? "" : ` of ${all.length}`} · times in UTC`}
        </span>
      </div>
      {from !== undefined && runs.data && <Hours runs={all} from={from} hour={hour} onPick={(h) => setHour(h === hour ? undefined : h)} />}
      {from !== undefined && all.length === DAY_LIMIT && <p className="dim small">the newest {DAY_LIMIT} of the day</p>}
      {runs.error && <p className="error">{runs.error}</p>}
      {runs.data ? (
        shown.length ? <RunsTable runs={shown} /> : <p className="empty">No runs {hour !== undefined ? `between ${hh(hour)} and ${hh(hour + 1)}` : day ? "that day" : "yet"}.</p>
      ) : (
        !runs.error && <p className="dim">loading…</p>
      )}
    </>
  );
}

function inHour(h: Run, from: number, hour: number): boolean {
  const t = ms(h.createdAt) ?? 0;
  return t >= from + hour * HOUR_MS && t < from + (hour + 1) * HOUR_MS;
}

// Hours: a day's runs by the hour they started, a bar each; picking one
// narrows the list to it. A bar is red if a run in it failed.
function Hours({ runs, from, hour, onPick }: { runs: Run[]; from: number; hour?: number; onPick: (h: number) => void }) {
  const byHour = Array.from({ length: 24 }, (_, h) => runs.filter((r) => inHour(r, from, h)));
  const most = Math.max(...byHour.map((rs) => rs.length), 1);
  return (
    <div className="hours" role="group" aria-label="runs by hour (UTC)">
      {byHour.map((rs, h) => {
        const failed = rs.filter((r) => r.status === "failed" || r.status === "stuck").length;
        const running = rs.some((r) => r.status === "running");
        const tone = failed ? "bad" : running ? "run" : rs.length ? "ok" : "none";
        return (
          <button
            key={h}
            type="button"
            className={`hour hour-${tone}${hour === h ? " picked" : ""}${hour !== undefined && hour !== h ? " faded" : ""}`}
            aria-label={`${hh(h)}: ${rs.length} ${rs.length === 1 ? "run" : "runs"}${failed ? `, ${failed} failed` : ""}`}
            aria-pressed={hour === h}
            title={`${hh(h)}–${hh(h + 1)} UTC: ${rs.length} ${rs.length === 1 ? "run" : "runs"}${failed ? `, ${failed} failed` : ""}`}
            onClick={() => onPick(h)}
          >
            <span className="hour-bar" style={{ height: rs.length ? `${Math.max((rs.length / most) * 100, 8)}%` : "2px" }} />
            <span className="hour-label">{h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
