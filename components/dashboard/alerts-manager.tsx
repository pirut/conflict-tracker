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
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Alerts</p>

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
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
          placeholder="Alert name"
        />

        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as AlertKind)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
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
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              placeholder="km"
            />
            <input
              type="number"
              step="0.01"
              value={lat}
              onChange={(event) => setLat(Number(event.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              placeholder="lat"
            />
            <input
              type="number"
              step="0.01"
              value={lon}
              onChange={(event) => setLon(Number(event.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
              placeholder="lon"
            />
          </div>
        ) : (
          <input
            type="number"
            value={thresholdPct}
            onChange={(event) => setThresholdPct(Number(event.target.value))}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
            placeholder="drop threshold"
          />
        )}

        <p className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600">
          {summary}
        </p>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-md border border-slate-900 bg-slate-900 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60"
        >
          {saving ? "Creating..." : "Create Alert"}
        </button>
      </form>

      <div className="mt-3 space-y-2">
        {alerts.map((alert) => (
          <div
            key={alert._id}
            className="rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-700"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{alert.name}</p>
                <p className="text-[11px] text-slate-500">{alert.kind.replace(/_/g, " ")}</p>
              </div>
              <button
                type="button"
                onClick={() => void deleteAlert({ alertId: alert._id as never })}
                className="rounded-md border border-rose-300 px-2 py-0.5 text-[11px] text-rose-700"
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
