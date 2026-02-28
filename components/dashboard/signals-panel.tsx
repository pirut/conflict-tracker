"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAgo } from "@/lib/format";
import { SignalRecord, AlertRule, NotificationItem } from "@/lib/types";
import { AlertsManager } from "./alerts-manager";

type SignalsPanelProps = {
  connectivitySignals: SignalRecord[];
  flightSignals: SignalRecord[];
  firmsSignals: SignalRecord[];
  alerts: AlertRule[];
  notifications: NotificationItem[];
};

export function SignalsPanel({
  connectivitySignals,
  flightSignals,
  firmsSignals,
  alerts,
  notifications,
}: SignalsPanelProps) {
  const [showFirms, setShowFirms] = useState(true);

  const connectivityData = useMemo(() => {
    return [...connectivitySignals]
      .slice(0, 80)
      .reverse()
      .map((signal) => ({
        time: new Date(signal.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        availability: Number(signal.payload?.availabilityPct ?? 0),
        region: String(signal.payload?.region ?? "Iran"),
      }));
  }, [connectivitySignals]);

  const flightAnomalies = useMemo(() => {
    return flightSignals.filter((signal) => Boolean(signal.payload?.anomaly));
  }, [flightSignals]);

  return (
    <section className="flex h-full min-h-[32rem] flex-col gap-3 rounded-2xl border border-white/15 bg-slate-950/55 p-4 shadow-glow backdrop-blur-xl">
      <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-200">Signals</h2>

      <div className="rounded-2xl border border-white/15 bg-slate-900/75 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Connectivity (24h)
        </p>
        <div className="mt-2 h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={connectivityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
              <XAxis dataKey="time" tick={{ fill: "#a8b5d5", fontSize: 11 }} minTickGap={24} />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#a8b5d5", fontSize: 11 }}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  background: "#0b1424",
                  border: "1px solid rgba(148,163,184,0.25)",
                  borderRadius: "12px",
                  color: "#e2e8f0",
                }}
              />
              <Line
                type="monotone"
                dataKey="availability"
                stroke="#4ecdc4"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-white/15 bg-slate-900/75 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Flight Disruption Alerts
        </p>
        <div className="mt-2 space-y-2">
          {flightAnomalies.length === 0 ? (
            <p className="text-xs text-slate-400">No sudden flight drops detected in this window.</p>
          ) : (
            flightAnomalies.slice(0, 6).map((signal) => (
              <div
                key={signal._id}
                className="rounded-lg border border-amber-300/35 bg-amber-500/8 p-2 text-xs"
              >
                <p className="font-semibold text-amber-100">
                  {String(signal.payload?.city ?? signal.payload?.region ?? "Region")}
                </p>
                <p className="text-amber-200/90">{String(signal.payload?.dropPct ?? "?")}% drop</p>
                <p className="mt-1 text-slate-400">{formatAgo(signal.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/15 bg-slate-900/75 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">FIRMS Hotspots</p>
          <button
            type="button"
            onClick={() => setShowFirms((value) => !value)}
            className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] text-slate-200"
          >
            {showFirms ? "Hide" : "Show"}
          </button>
        </div>

        {showFirms ? (
          <div className="mt-2 space-y-2">
            {firmsSignals.slice(0, 5).map((signal) => (
              <div key={signal._id} className="rounded-lg border border-white/10 bg-slate-950/60 p-2 text-xs">
                <p className="font-semibold text-slate-100">
                  {String(signal.payload?.region ?? "Iran")}
                </p>
                <p className="text-slate-400">
                  Brightness: {String(signal.payload?.brightness ?? signal.payload?.bright_ti4 ?? "n/a")}
                </p>
              </div>
            ))}
            {firmsSignals.length === 0 ? (
              <p className="text-xs text-slate-400">No hotspot rows yet for selected window.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <AlertsManager alerts={alerts} />

      <div className="rounded-2xl border border-white/15 bg-slate-900/75 p-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          In-app Notifications
        </p>
        <div className="mt-2 space-y-2">
          {notifications.slice(0, 6).map((notification) => (
            <div
              key={notification._id}
              className={`rounded-lg border p-2 text-xs ${
                notification.severity === "high"
                  ? "border-rose-300/40 bg-rose-500/10 text-rose-100"
                  : notification.severity === "medium"
                    ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                    : "border-cyan-300/35 bg-cyan-500/10 text-cyan-100"
              }`}
            >
              <p>{notification.message}</p>
              <p className="mt-1 text-[11px] opacity-80">{formatAgo(notification.createdAt)}</p>
            </div>
          ))}
          {notifications.length === 0 ? (
            <p className="text-xs text-slate-400">No notifications yet.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
