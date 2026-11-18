import type { ReactNode } from "react";

import { Link, type Route } from "../router";

// Crumbs is where a page sits: links back up, ending with the page itself.
export function Crumbs({ items }: { items: { label: ReactNode; to?: Route }[] }) {
  return (
    <nav className="crumbs" aria-label="breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="crumb">
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
