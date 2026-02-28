"use client";

import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AlertRule } from "@/lib/types";

type AlertsManagerProps = {
  alerts: AlertRule[];
};

type AlertKind = "strike_proximity" | "connectivity_drop";

export function AlertsManager({ alerts }: AlertsManagerProps) {
  const createAlert = useMutation(api.events.createAlert);
  const deleteAlert = useMutation(api.events.deleteAlert);

  const [name, setName] = useState("High confidence strike near Tehran");
  const [kind, setKind] = useState<AlertKind>("strike_proximity");
  const [radiusKm, setRadiusKm] = useState(120);
  const [lat, setLat] = useState(35.6892);
  const [lon, setLon] = useState(51.389);
  const [thresholdPct, setThresholdPct] = useState(20);
  const [saving, setSaving] = useState(false);

  const summary = useMemo(() => {
    if (kind === "strike_proximity") {
      return `High-confidence strike events within ${radiusKm} km of (${lat.toFixed(2)}, ${lon.toFixed(2)}).`;
    }
    return `Connectivity drop greater than ${thresholdPct}% below full availability.`;
  }, [kind, radiusKm, lat, lon, thresholdPct]);

  return (
    <div className="rounded-2xl border border-white/15 bg-slate-900/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Alerts</p>

      <form
        className="mt-2 space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            if (kind === "strike_proximity") {
              await createAlert({
                name,
                kind,
                radiusKm,
                lat,
                lon,
                enabled: true,
              });
            } else {
              await createAlert({
                name,
                kind,
                thresholdPct,
                enabled: true,
              });
            }
          } finally {
            setSaving(false);
          }
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100"
          placeholder="Alert name"
        />

        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as AlertKind)}
          className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-2 py-1.5 text-xs text-slate-100"
        >
          <option value="strike_proximity">High confidence strike within X km</option>
          <option value="connectivity_drop">Connectivity drop &gt; Y%</option>
        </select>

        {kind === "strike_proximity" ? (
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
              className="rounded-lg border border-white/20 bg-slate-950/70 px-2 py-1.5 text-xs"
              placeholder="km"
            />
            <input
              type="number"
              step="0.01"
              value={lat}
              onChange={(event) => setLat(Number(event.target.value))}
              className="rounded-lg border border-white/20 bg-slate-950/70 px-2 py-1.5 text-xs"
              placeholder="lat"
            />
            <input
              type="number"
              step="0.01"
              value={lon}
              onChange={(event) => setLon(Number(event.target.value))}
              className="rounded-lg border border-white/20 bg-slate-950/70 px-2 py-1.5 text-xs"
              placeholder="lon"
            />
          </div>
        ) : (
          <input
            type="number"
            value={thresholdPct}
            onChange={(event) => setThresholdPct(Number(event.target.value))}
            className="w-full rounded-lg border border-white/20 bg-slate-950/70 px-2 py-1.5 text-xs"
            placeholder="drop threshold"
          />
        )}

        <p className="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-400">
          {summary}
        </p>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg border border-cyan-300/50 bg-cyan-400/10 px-2 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60"
        >
          {saving ? "Creating..." : "Create Alert"}
        </button>
      </form>

      <div className="mt-3 space-y-2">
        {alerts.map((alert) => (
          <div
            key={alert._id}
            className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-xs text-slate-300"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-100">{alert.name}</p>
                <p className="text-[11px] text-slate-400">{alert.kind.replace(/_/g, " ")}</p>
              </div>
              <button
                type="button"
                onClick={() => void deleteAlert({ alertId: alert._id as never })}
                className="rounded-md border border-rose-300/40 px-2 py-0.5 text-[11px] text-rose-200"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
