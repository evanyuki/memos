import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GalleryExifSectionProps {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

export function GalleryExifSection({ title, children, className }: GalleryExifSectionProps) {
  return (
    <section
      className={cn("gallery-inspector-section flex flex-col gap-2", className)}
      aria-label={typeof title === "string" ? title : undefined}
    >
      <h3 className="text-sm font-medium text-[var(--gallery-foreground)]">{title}</h3>
      {children}
    </section>
  );
}

export function GalleryExifRow({ label, value, truncate = false }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs leading-5">
      <dt className="shrink-0 text-[var(--gallery-muted)]">{label}</dt>
      <dd className={cn("min-w-0 text-right tabular-nums", truncate ? "truncate" : "break-words")} title={truncate ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}
