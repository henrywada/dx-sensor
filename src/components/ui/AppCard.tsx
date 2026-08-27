import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface AppCardProps {
  icon: LucideIcon;
  eyebrow?: string; // short colored label above the title, e.g. "駐車場の空き状況"
  title: string;
  description: string;
  href?: string;
  badge?: string; // e.g. "準備中" for not-yet-built apps
}

export function AppCard({ icon: Icon, eyebrow, title, description, href, badge }: AppCardProps) {
  const disabled = !href;

  const content = (
    <div
      className={`scan-card flex h-full flex-col rounded-lg border border-line bg-white p-5 transition-colors ${
        disabled ? "opacity-60" : "hover:border-signal/50"
      }`}
    >
      <div className="flex items-start justify-between">
        {eyebrow && (
          <span className="font-en text-xs font-semibold uppercase tracking-wide text-signal">
            {eyebrow}
          </span>
        )}
        {badge && (
          <span className="ml-auto rounded-full bg-line px-2.5 py-0.5 text-[11px] text-ink-soft">
            {badge}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-signal-soft text-signal">
          <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
        </span>
        <h3 className="min-w-0 flex-1 text-base font-bold text-ink">{title}</h3>
        {!disabled && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-medium text-signal">
            進む
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>
    </div>
  );

  if (disabled) {
    return <div aria-disabled="true">{content}</div>;
  }

  return (
    <Link href={href} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-signal">
      {content}
    </Link>
  );
}
