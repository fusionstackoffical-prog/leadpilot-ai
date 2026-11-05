import { CheckCircle2, CircleDashed, FileSearch, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/features/imports/status";
import {
  describeMethod,
  type MissingItem,
  type PresentedAssessment,
  type PresentedFinding,
  type PresentedSource,
  type PresentedWarning,
} from "../presenter";

/**
 * Everything on this page that comes from a company's website is UNTRUSTED. It is rendered as
 * plain text only (React escapes it); there is no raw HTML anywhere in this file. An address
 * becomes a link only when the presenter already approved it (`href` is null otherwise), and
 * every external link carries rel="noopener noreferrer nofollow".
 */

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

/** "streetAddress" -> "Street address" */
function humanize(label: string) {
  const words = label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function SourceLine({ source, timezone }: { source: PresentedSource; timezone: string }) {
  return (
    <p className="mt-1.5 text-xs break-words text-fg-muted">
      Source:{" "}
      {source.href ? (
        <a href={source.href} {...EXTERNAL} className="break-all text-accent hover:underline">
          {source.urlText}
        </a>
      ) : (
        <span className="break-all">{source.urlText}</span>
      )}
      {source.label !== source.urlText ? ` · ${source.label}` : null}
      {` · retrieved ${formatDateTime(source.retrievedAt, timezone)}`}
    </p>
  );
}

function FindingItem({ item, timezone }: { item: PresentedFinding; timezone: string }) {
  const confirmed = item.verification === "confirmed";
  const how = describeMethod(item.method);
  return (
    <li className="rounded-md border border-line bg-elevated/40 p-3" data-testid="finding">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-sm break-words text-fg">
          {item.href ? (
            <a href={item.href} {...EXTERNAL} className="text-accent hover:underline">
              {item.value}
            </a>
          ) : (
            item.value
          )}
        </p>
        <Badge
          tone={confirmed ? "success" : "warning"}
          icon={
            confirmed ? (
              <CheckCircle2 className="size-3" aria-hidden />
            ) : (
              <CircleDashed className="size-3" aria-hidden />
            )
          }
        >
          {confirmed ? "Confirmed" : "Unconfirmed"}
        </Badge>
      </div>

      <p className="mt-1 text-[11px] text-fg-muted">
        {confirmed
          ? `Confirmed: the quote below was checked against the stored page text${item.verifiedAt ? ` on ${formatDateTime(item.verifiedAt, timezone)}` : ""}.`
          : `${item.verificationLabel}. Review it before relying on it.`}
        {how ? ` Found in ${how}.` : null}
      </p>

      {item.details.length > 0 ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {item.details.map((d) => (
            <div key={d.label} className="contents">
              <dt className="text-fg-muted">{humanize(d.label)}</dt>
              <dd className="break-words text-fg-secondary">{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {item.source ? (
        <SourceLine source={item.source} timezone={timezone} />
      ) : (
        <p className="mt-1.5 text-xs text-warning">Source unavailable.</p>
      )}

      {item.quote ? (
        <blockquote className="mt-1.5 border-l-2 border-line pl-3 text-xs break-words whitespace-pre-wrap text-fg-secondary">
          “{item.quote}”
        </blockquote>
      ) : (
        <p className="mt-1.5 text-xs text-warning">Supporting quote unavailable.</p>
      )}

      {item.extraEvidence.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 border-l-2 border-line pl-3 text-xs text-fg-muted">
          {item.extraEvidence.map((line, i) => (
            <li key={i} className="break-words whitespace-pre-wrap">
              Also supported by: “{line}”
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Findings with their source, supporting quote and verification status. */
export function FindingList({
  items,
  empty,
  timezone,
}: {
  items: PresentedFinding[];
  /** Shown when there are none; chosen by the caller so it never claims more than is true. */
  empty: string;
  timezone: string;
}) {
  if (items.length === 0) return <p className="text-xs text-fg-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <FindingItem key={item.id} item={item} timezone={timezone} />
      ))}
    </ul>
  );
}

/** AI assessments, always labelled as assessments. None exist until the AI phase. */
export function AssessmentList({ items, empty }: { items: PresentedAssessment[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-fg-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-md border border-info/30 bg-info/5 p-3 text-sm">
          <p className="break-words whitespace-pre-wrap text-fg">{item.text}</p>
          <p className="mt-1 text-[11px] text-fg-muted">
            AI assessment, not a confirmed fact
            {item.confidence !== null ? ` · confidence ${Math.round(item.confidence * 100)}%` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The pages a run read. */
export function PagesResearched({
  sources,
  timezone,
}: {
  sources: PresentedSource[];
  timezone: string;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[520px] text-left text-xs" data-testid="pages-table">
        <thead className="bg-elevated text-fg-secondary">
          <tr>
            <th className="px-3 py-2 font-medium">Page</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Retrieved</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} className="border-t border-line align-top">
              <td className="max-w-72 px-3 py-2 break-all">
                {s.href ? (
                  <a href={s.href} {...EXTERNAL} className="text-accent hover:underline">
                    {s.urlText}
                  </a>
                ) : (
                  s.urlText
                )}
              </td>
              <td className="max-w-48 truncate px-3 py-2 text-fg-secondary">
                {s.label !== s.urlText ? s.label : "—"}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-fg-secondary">
                {formatDateTime(s.retrievedAt, timezone)}
              </td>
              <td className="tabular px-3 py-2 text-fg-secondary">{s.httpStatus ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Warnings from the run, and what it did not find. */
export function ResearchNotes({
  warnings,
  missing,
  showMissing,
  notFoundText,
}: {
  warnings: PresentedWarning[];
  missing: MissingItem[];
  /** Only true for a run that finished: "not found" means nothing for a run that didn't. */
  showMissing: boolean;
  notFoundText: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-fg-muted uppercase">
          <TriangleAlert className="size-3.5" aria-hidden />
          Warnings
        </p>
        {warnings.length === 0 ? (
          <p className="text-xs text-fg-muted">The research reported no warnings.</p>
        ) : (
          <ul className="space-y-2" data-testid="warnings">
            {warnings.map((w, i) => (
              <li key={i} className="rounded-md border border-warning/30 bg-warning/5 p-2.5">
                <p className="text-xs font-medium text-fg">{w.title}</p>
                <p className="mt-0.5 text-xs text-fg-secondary">{w.detail}</p>
                {w.page ? (
                  <p className="mt-0.5 text-[11px] text-fg-muted">
                    Page:{" "}
                    {w.href ? (
                      <a href={w.href} {...EXTERNAL} className="text-accent hover:underline">
                        {w.page}
                      </a>
                    ) : (
                      w.page
                    )}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showMissing ? (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-fg-muted uppercase">
            <FileSearch className="size-3.5" aria-hidden />
            Missing information
          </p>
          {missing.length === 0 ? (
            <p className="text-xs text-fg-muted">
              Something was found for every kind of information.
            </p>
          ) : (
            <>
              <p className="mb-1.5 text-xs text-fg-secondary">{notFoundText}</p>
              <ul className="flex flex-wrap gap-1.5" data-testid="missing">
                {missing.map((m) => (
                  <li key={m.key}>
                    <Badge tone="neutral">{m.label}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
