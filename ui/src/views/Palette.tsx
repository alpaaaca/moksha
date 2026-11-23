import { useEffect, useMemo, useRef, useState } from "react";

import { useApi } from "../api";
import { ago, inputsText } from "../format";
import { usePoll } from "../hooks";
import { Icon } from "../icons";
import { usePipelines } from "../pipelines";
import { navigate, type Route } from "../router";

type Item = { key: string; group: string; label: string; hint: string; icon: string; to: Route };

const RECENT = 20;

// Palette (⌘K): find a page, a pipeline or a recent run by typing, and go
// there with the keyboard.
export function Palette({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const pipelines = usePipelines();
  const recent = usePoll(() => api.runs.listRuns({ limit: RECENT }), [], 0);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const all: Item[] = [
      { key: "p:runs", group: "Pages", label: "Pipelines", hint: "", icon: "pipelines", to: { name: "runs" } },
      { key: "p:signals", group: "Pages", label: "Signals", hint: "", icon: "signals", to: { name: "signals" } },
      { key: "p:loops", group: "Pages", label: "Loops", hint: "", icon: "loops", to: { name: "loops" } },
      { key: "p:activity", group: "Pages", label: "Runs", hint: "", icon: "runs", to: { name: "activity" } },
      { key: "p:workers", group: "Pages", label: "Workers", hint: "", icon: "workers", to: { name: "workers" } },
      ...[...new Set(pipelines.names.map((n) => pipelines.info(n)?.group).filter((g): g is string => !!g))].sort().map((g) => ({
        key: `g:${g}`, group: "Groups", label: g, hint: "group of pipelines", icon: "group", to: { name: "group" as const, group: g },
      })),
      ...pipelines.names.map((n) => ({
        key: `pl:${n}`, group: "Pipelines", label: pipelines.title(n), hint: [pipelines.info(n)?.group, n].filter(Boolean).join(" / "), icon: "pipelines", to: { name: "pipeline" as const, run: n },
      })),
      ...pipelines.loops.map((n) => ({
        key: `lp:${n}`, group: "Loops", label: pipelines.title(n), hint: n, icon: "loops", to: { name: "pipeline" as const, run: n },
      })),
      ...(recent.data?.runs ?? []).map((h) => ({
        key: `r:${h.id}`, group: "Recent runs", label: `${pipelines.title(h.name)} · ${inputsText(h)}`, hint: `${h.status} · ${ago(h.createdAt)}`,
        icon: "runs", to: { name: "run" as const, id: h.id },
      })),
    ];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((it) => words.every((w) => `${it.label} ${it.hint}`.toLowerCase().includes(w)));
  }, [q, pipelines, recent.data]);

  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector(".active")?.scrollIntoView?.({ block: "nearest" });
  }, [at]);

  function go(it?: Item) {
    if (!it) return;
    navigate(it.to);
    onClose();
  }

  function key(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[at]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let group = "";
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[at] ? `pi-${items[at].key}` : undefined}
            aria-label="search pipelines and runs"
            placeholder="Search pipelines and runs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={key}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
          {items.length === 0 && <li className="palette-empty">Nothing matches “{q}”</li>}
          {items.map((it, i) => {
            const head = it.group !== group;
            group = it.group;
            return (
              <li key={it.key} role="presentation">
                {head && <div className="palette-group">{it.group}</div>}
                <div
                  id={`pi-${it.key}`}
                  role="option"
                  aria-selected={i === at}
                  className={`palette-item${i === at ? " active" : ""}`}
                  onMouseMove={() => setAt(i)}
                  onClick={() => go(it)}
                >
                  <Icon name={it.icon} size={14} />
                  <span className="palette-label">{it.label}</span>
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}
