"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntroPath, Person } from "@/lib/shared";
import { IntroMap } from "./IntroMap";
import {
  WeightControls,
  DEFAULT_WEIGHT_STATE,
  loadStoredWeights,
  type WeightState,
} from "./WeightControls";

interface TargetResponse {
  target: Person;
  matchConfidence: number;
  source: "pdl" | "manual";
  alternatives: Array<{ name: string; company?: string; linkedinUrl?: string; matchScore: number }>;
  paths: IntroPath[];
  names: Record<string, string>;
}

interface IntroResponse {
  draft: string;
  validation: { valid: boolean; warnings: string[]; errors: string[] };
}

interface Query {
  name: string;
  company: string;
  linkedinUrl: string;
}

export function Finder() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [reranking, setReranking] = useState(false);
  const [result, setResult] = useState<TargetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [weights, setWeights] = useState<WeightState>(DEFAULT_WEIGHT_STATE);
  const lastQuery = useRef<Query | null>(null);

  // Load persisted weights after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    setWeights(loadStoredWeights());
  }, []);

  const runSearch = useCallback(
    async (query: Query, w: WeightState, mode: "search" | "rerank") => {
      if (mode === "search") {
        setBusy(true);
        setError(null);
        setResult(null);
      } else {
        setReranking(true);
      }
      try {
        const res = await fetch("/api/target", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...query, weights: w }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body.error ?? "Search failed");
          return;
        }
        const map = new Map<string, string>(Object.entries(body.names ?? {}));
        map.set(body.target.id, body.target.name);
        setNameById(map);
        setResult(body);
        lastQuery.current = query;
      } finally {
        setBusy(false);
        setReranking(false);
      }
    },
    [],
  );

  function search(e: React.FormEvent) {
    e.preventDefault();
    runSearch({ name, company, linkedinUrl }, weights, "search");
  }

  // Live re-rank when weights change and we already have a result.
  useEffect(() => {
    if (!lastQuery.current) return;
    const q = lastQuery.current;
    const t = setTimeout(() => {
      runSearch(q, weights, "rerank");
    }, 350);
    return () => clearTimeout(t);
  }, [weights, runSearch]);

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Find a warm intro</h1>
        <p className="page-sub">
          Search a target and we&apos;ll rank the best people in your team&apos;s network to make the intro.
        </p>
      </div>

      <form className="card" onSubmit={search}>
        <div className="grid two">
          <div>
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" />
          </div>
          <div>
            <label>Company (optional)</label>
            <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Stripe" />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>LinkedIn URL (optional, improves match)</label>
          <input
            type="text"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/alexrivera"
          />
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="submit" disabled={busy}>
            {busy ? "Searching\u2026" : "Find intro paths"}
          </button>
        </div>
      </form>

      <WeightControls weights={weights} onChange={setWeights} />

      {error && <div className="notice danger">{error}</div>}

      {result && <Results result={result} nameById={nameById} reranking={reranking} />}
    </div>
  );
}

function Results({
  result,
  nameById,
  reranking,
}: {
  result: TargetResponse;
  nameById: Map<string, string>;
  reranking: boolean;
}) {
  const nameOf = (id: string) => nameById.get(id) ?? "Connector";

  return (
    <div className={reranking ? "stack reranking" : "stack"}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="connector-name">{result.target.name}</div>
            <div className="connector-sub">
              {result.target.title ? `${result.target.title} \u00b7 ` : ""}
              {result.target.company ?? "Unknown company"}
            </div>
          </div>
          <div className="badge">
            {reranking ? "Re-ranking\u2026" : `${result.source === "pdl" ? "PDL match" : "Manual"} ${Math.round(result.matchConfidence * 100)}%`}
          </div>
        </div>
        {result.source === "pdl" && result.matchConfidence < 0.75 && result.alternatives.length > 0 && (
          <div className="notice warn" style={{ marginTop: 12 }}>
            Low-confidence match. Other possibilities:{" "}
            {result.alternatives.map((a) => `${a.name}${a.company ? ` (${a.company})` : ""}`).join("; ")}
          </div>
        )}
      </div>

      {result.paths.length > 0 ? (
        <>
          <IntroMap target={result.target} paths={result.paths} personName={nameOf} />
          <div className="stack">
            {result.paths.map((p) => (
              <PathCard key={p.connectorId} path={p} targetId={result.target.id} connectorName={nameOf(p.connectorId)} viaName={nameOf(p.viaTeamMemberId)} />
            ))}
          </div>
        </>
      ) : (
        <div className="empty">
          No viable intro paths yet. Ask teammates to connect their networks under
          &nbsp;<strong>Connect data</strong>, or add an orbit contact who knows this person.
        </div>
      )}
    </div>
  );
}

function PathCard({
  path,
  targetId,
  connectorName,
  viaName,
}: {
  path: IntroPath;
  targetId: string;
  connectorName: string;
  viaName: string;
}) {
  const [purpose, setPurpose] = useState("");
  const [intro, setIntro] = useState<IntroResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const b = path.breakdown;

  async function draft() {
    setBusy(true);
    const res = await fetch("/api/intro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId, connectorId: path.connectorId, purpose }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setIntro(body);
    setBusy(false);
  }

  return (
    <div className="path-card">
      <div className="path-head">
        <div>
          <div className="connector-name">{connectorName}</div>
          <div className="connector-sub">
            {path.viaTeamMemberId === path.connectorId
              ? "In your team\u2019s direct network"
              : `Reachable via ${viaName}`}
          </div>
        </div>
        <div className="row">
          <span className={`badge ${path.veracity}`}>{path.veracity}</span>
          <span className="score">{b.composite}</span>
        </div>
      </div>

      <div className="rubric">
        <Cell k="To target" v={b.closenessToTarget} />
        <Cell k="Credibility" v={b.credibility} />
        <Cell k="To you" v={b.closenessToYou} />
        <Cell k="Responds" v={b.responsiveness} />
        <Cell k="Consent" v={b.riskConsent} />
      </div>

      <ul className="evidence">
        {path.evidenceSummary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>

      <div className="row">
        <input
          type="text"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="What's the intro about? (e.g. hiring a founding engineer)"
        />
        <button className="secondary" onClick={draft} disabled={busy}>
          {busy ? "Drafting\u2026" : "Draft ask"}
        </button>
      </div>

      {intro && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="notice info" style={{ whiteSpace: "pre-wrap" }}>{intro.draft}</div>
          {intro.validation.errors.map((e, i) => (
            <div key={`e${i}`} className="notice danger">{e}</div>
          ))}
          {intro.validation.warnings.map((w, i) => (
            <div key={`w${i}`} className="notice warn">{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({ k, v }: { k: string; v: number }) {
  return (
    <div className="rubric-cell">
      <span className="k">{k}</span>
      <span className="v">{Math.round(v * 100)}</span>
    </div>
  );
}
