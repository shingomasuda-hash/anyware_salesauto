import type { ReactNode } from "react";

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-lg border">
      <div className="flex items-center justify-between border-b px-5 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[7.5rem_1fr] gap-2">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 break-words">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExternalA({ href, children }: { href: string | null | undefined; children?: ReactNode }) {
  if (!href) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-sky-700 hover:underline">
      {children ?? href}
    </a>
  );
}

export function BulletList({ items, empty = "なし" }: { items: unknown; empty?: string }) {
  const list = Array.isArray(items) ? items.filter((x): x is string => typeof x === "string") : [];
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {list.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function ScoreTile({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value ?? "—"}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
