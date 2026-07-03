"use client";

import { useEffect, useMemo, useState } from "react";
import type { RubricWeights } from "@/lib/shared";

/** Raw slider values (0-100). Normalized server-side before scoring. */
export type WeightState = Record<keyof RubricWeights, number>;

export const DEFAULT_WEIGHT_STATE: WeightState = {
  closenessToTarget: 40,
  credibility: 25,
  closenessToYou: 20,
  responsiveness: 10,
  riskConsent: 5,
};

const FIELDS: { key: keyof RubricWeights; label: string; hint: string }[] = [
  { key: "closenessToTarget", label: "Closeness to target", hint: "Engagement + tie strength with the person" },
  { key: "credibility", label: "Credibility", hint: "Seniority / how vouch-worthy the connector is" },
  { key: "closenessToYou", label: "Closeness to you", hint: "How well your team knows the connector" },
  { key: "responsiveness", label: "Responsiveness", hint: "Past intro accept rate" },
  { key: "riskConsent", label: "Consent / risk", hint: "Opted-in and low-risk to ask" },
];

const PRESETS: { name: string; weights: WeightState }[] = [
  { name: "Balanced", weights: DEFAULT_WEIGHT_STATE },
  { name: "Warmest tie", weights: { closenessToTarget: 60, credibility: 15, closenessToYou: 15, responsiveness: 5, riskConsent: 5 } },
  { name: "Most likely to say yes", weights: { closenessToTarget: 25, credibility: 15, closenessToYou: 25, responsiveness: 30, riskConsent: 5 } },
  { name: "Credible voucher", weights: { closenessToTarget: 30, credibility: 45, closenessToYou: 15, responsiveness: 5, riskConsent: 5 } },
];

const STORAGE_KEY = "intro-mapper:weights";

export function loadStoredWeights(): WeightState {
  if (typeof window === "undefined") return DEFAULT_WEIGHT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WEIGHT_STATE;
    const parsed = JSON.parse(raw) as Partial<WeightState>;
    return { ...DEFAULT_WEIGHT_STATE, ...parsed };
  } catch {
    return DEFAULT_WEIGHT_STATE;
  }
}

export function WeightControls({
  weights,
  onChange,
}: {
  weights: WeightState;
  onChange: (w: WeightState) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(weights));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [weights]);

  const total = useMemo(
    () => FIELDS.reduce((sum, f) => sum + (weights[f.key] || 0), 0) || 1,
    [weights],
  );

  const set = (key: keyof RubricWeights, value: number) => onChange({ ...weights, [key]: value });
  const isDefault = FIELDS.every((f) => weights[f.key] === DEFAULT_WEIGHT_STATE[f.key]);

  return (
    <div className="weights">
      <button
        type="button"
        className="ghost weights-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Ranking weights</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {isDefault ? "Balanced" : "Custom"} {open ? "\u2013" : "+"}
        </span>
      </button>

      {open && (
        <div className="weights-body">
          <div className="weights-presets">
            {PRESETS.map((p) => {
              const active = FIELDS.every((f) => weights[f.key] === p.weights[f.key]);
              return (
                <button
                  key={p.name}
                  type="button"
                  className={active ? "chip chip-active" : "chip"}
                  onClick={() => onChange({ ...p.weights })}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          {FIELDS.map((f) => {
            const pct = Math.round(((weights[f.key] || 0) / total) * 100);
            return (
              <div key={f.key} className="weight-row">
                <div className="weight-head">
                  <div>
                    <span className="weight-label">{f.label}</span>
                    <span className="weight-hint">{f.hint}</span>
                  </div>
                  <span className="weight-pct">{pct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={weights[f.key]}
                  onChange={(e) => set(f.key, Number(e.target.value))}
                />
              </div>
            );
          })}

          <div className="row" style={{ justifyContent: "flex-end", marginTop: 4 }}>
            <button
              type="button"
              className="ghost"
              onClick={() => onChange({ ...DEFAULT_WEIGHT_STATE })}
              disabled={isDefault}
            >
              Reset to balanced
            </button>
          </div>
          <p className="muted" style={{ fontSize: 11.5, margin: "2px 0 0" }}>
            Weights are normalized, so only their relative sizes matter. Changes re-rank instantly.
          </p>
        </div>
      )}
    </div>
  );
}
