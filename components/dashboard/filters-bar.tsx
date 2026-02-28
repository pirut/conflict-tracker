"use client";

import { Search } from "lucide-react";

export type DashboardFilters = {
  timeRangeHours: number;
  minConfidence: number;
  category: string;
  q: string;
  sourceTypes: {
    news: boolean;
    signals: boolean;
    social: boolean;
  };
};

type FiltersBarProps = {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
};

const TIME_RANGES = [
  { label: "1h", value: 1 },
  { label: "6h", value: 6 },
  { label: "24h", value: 24 },
  { label: "7d", value: 24 * 7 },
];

const CATEGORIES = [
  "all",
  "strike",
  "explosion",
  "air_defense",
  "missile",
  "drone",
  "refinery",
  "nuclear",
  "military_base",
  "connectivity",
  "flight",
  "fire",
  "other",
];

export function FiltersBar({ filters, onChange }: FiltersBarProps) {
  return (
    <section className="relative z-10 rounded-2xl border border-white/15 bg-slate-950/55 p-4 shadow-glow backdrop-blur-xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {TIME_RANGES.map((range) => (
            <button
              key={range.value}
              type="button"
              onClick={() => onChange({ ...filters, timeRangeHours: range.value })}
              className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-wide transition ${
                filters.timeRangeHours === range.value
                  ? "border-cyan-300/80 bg-cyan-300/20 text-cyan-100"
                  : "border-white/20 text-slate-300 hover:border-cyan-200/40 hover:text-cyan-50"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>

        <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-4 lg:w-auto lg:grid-cols-3 xl:grid-cols-4">
          <label className="text-xs text-slate-300">
            <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-400">
              Confidence
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={filters.minConfidence}
              onChange={(event) =>
                onChange({ ...filters, minConfidence: Number(event.target.value) })
              }
              className="w-full"
            />
            <span className="font-mono text-xs text-cyan-200">{filters.minConfidence}+</span>
          </label>

          <label className="text-xs text-slate-300">
            <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-400">
              Category
            </span>
            <select
              value={filters.category}
              onChange={(event) => onChange({ ...filters, category: event.target.value })}
              className="w-full rounded-xl border border-white/20 bg-slate-900/70 px-2 py-2 text-sm text-slate-100"
            >
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>

          <div className="text-xs text-slate-300">
            <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-400">
              Source Types
            </span>
            <div className="flex gap-2">
              {([
                ["news", "News"],
                ["signals", "Signals"],
                ["social", "Social"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...filters,
                      sourceTypes: {
                        ...filters.sourceTypes,
                        [key]: !filters.sourceTypes[key],
                      },
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    filters.sourceTypes[key]
                      ? "border-emerald-300/80 bg-emerald-300/15 text-emerald-100"
                      : "border-white/20 text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="text-xs text-slate-300">
            <span className="mb-1 block font-semibold uppercase tracking-wider text-slate-400">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
              <input
                value={filters.q}
                onChange={(event) => onChange({ ...filters, q: event.target.value })}
                placeholder="keyword or location"
                className="w-full rounded-xl border border-white/20 bg-slate-900/70 py-2 pl-8 pr-2 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </label>
        </div>
      </div>
    </section>
  );
}
