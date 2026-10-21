"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { explainStatus, VIDEO_STATUSES } from "@/lib/format";
import { RANGES, type VideosQuery } from "./params";

const ALL = "all";

export function VideoFilters({ query, rubrics }: { query: VideosQuery; rubrics: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(query.q ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Any filter change starts again from the first page.
  const apply = (patch: Partial<VideosQuery>) => {
    const next = { ...query, ...patch, cursor: undefined, prev: undefined };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, String(v));
    const s = params.toString();
    start(() => router.push(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const onSearch = (value: string) => {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value.trim() || undefined }), 300);
  };

  const active = Boolean(query.decision || query.status || query.rubric || query.range || query.q);

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter videos">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by external id"
          aria-label="Search by external id"
          className="pl-9"
        />
      </div>
      <FilterSelect
        label="Decision"
        value={query.decision}
        onChange={(v) => apply({ decision: v as VideosQuery["decision"] })}
        options={[
          ["accept", "Accepted"],
          ["reject", "Rejected"],
          ["review", "Sent to review"],
        ]}
        allLabel="Any decision"
      />
      <FilterSelect
        label="Status"
        value={query.status}
        onChange={(v) => apply({ status: v as VideosQuery["status"] })}
        options={VIDEO_STATUSES.map((s) => [s, explainStatus(s)])}
        allLabel="Any status"
      />
      <FilterSelect
        label="Rubric"
        value={query.rubric}
        onChange={(v) => apply({ rubric: v })}
        options={rubrics.map((r) => [r.id, r.name])}
        allLabel="Any rubric"
      />
      <FilterSelect
        label="Date"
        value={query.range}
        onChange={(v) => apply({ range: v as VideosQuery["range"] })}
        options={Object.entries(RANGES)}
        allLabel="Any time"
      />
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            start(() => router.push(pathname, { scroll: false }));
          }}
        >
          <X aria-hidden />
          Clear
        </Button>
      )}
      <span className="ml-1 inline-flex size-4 items-center" aria-live="polite">
        {pending && <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
      </span>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: [string, string][];
  allLabel: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className="w-auto min-w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
