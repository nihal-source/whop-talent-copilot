import { useCallback, useEffect, useRef, useState } from "react";

import type { IntroPath, Person, ProfileData } from "@whop-copilot/shared";

/**
 * Intro Paths tab. A thin client over the Intro Mapper web app: it connects
 * accounts (deep link), uploads the user's own export files, and — when viewing a
 * LinkedIn profile — shows the top intro-makers for that person from the team
 * graph. All heavy logic (parsing, scoring, grounding) lives in the web app;
 * this panel never scrapes connection data.
 */

interface IntroConfig {
  url: string;
  token: string;
}

interface TargetResponse {
  target: Person;
  matchConfidence: number;
  source: "pdl" | "manual";
  paths: IntroPath[];
}

const CONFIG_KEY = "intro_mapper_config";
const DEFAULT_URL = "http://localhost:3000";

async function loadConfig(): Promise<IntroConfig> {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  return { url: DEFAULT_URL, token: "", ...(stored[CONFIG_KEY] ?? {}) };
}

async function saveConfig(config: IntroConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

function api(config: IntroConfig, path: string): string {
  return `${config.url.replace(/\/+$/, "")}${path}`;
}

export function IntroPaths({ profile }: { profile: ProfileData | null }) {
  const [config, setConfig] = useState<IntroConfig>({ url: DEFAULT_URL, token: "" });
  const [showConfig, setShowConfig] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TargetResponse | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadConfig().then((c) => {
      setConfig(c);
      if (!c.token) setShowConfig(true);
    });
  }, []);

  const lookup = useCallback(async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(api(config, "/api/target"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({
          name: profile.name,
          company: profile.currentCompany,
          linkedinUrl: profile.linkedinUrl,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Lookup failed");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }, [config, profile]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setUploadMsg(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch(api(config, "/api/upload"), {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}` },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Upload failed");
      setUploadMsg(`Added ${body.added} connections, merged ${body.merged} duplicates.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <div className="intro-actions">
        <button className="btn secondary" onClick={() => window.open(api(config, "/onboarding"), "_blank")}>
          Connect accounts
        </button>
        <button className="btn secondary" onClick={() => fileRef.current?.click()}>
          Upload export
        </button>
        <button className="btn ghost" onClick={() => setShowConfig((s) => !s)}>
          {showConfig ? "Hide setup" : "Setup"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => upload(e.target.files)}
        />
      </div>

      {showConfig && (
        <div className="intro-config">
          <label>Intro Mapper URL</label>
          <input
            type="text"
            value={config.url}
            onChange={(e) => setConfig({ ...config, url: e.target.value })}
            placeholder={DEFAULT_URL}
          />
          <label>Access token</label>
          <input
            type="text"
            value={config.token}
            onChange={(e) => setConfig({ ...config, token: e.target.value })}
            placeholder="Paste from Intro Mapper -> Connect data"
          />
          <button
            className="btn"
            onClick={async () => {
              await saveConfig(config);
              setShowConfig(false);
            }}
          >
            Save
          </button>
          <p className="muted">
            Get your token from the Intro Mapper web app (Connect data page). Nothing here scrapes
            LinkedIn — it reads the team graph you and your teammates opted into.
          </p>
        </div>
      )}

      {uploadMsg && <div className="intro-note">{uploadMsg}</div>}
      {error && <div className="error">{error}</div>}

      {profile ? (
        <div className="intro-lookup">
          <div className="intro-target">
            <strong>{profile.name}</strong>
            <span className="muted">{profile.currentCompany || "Unknown company"}</span>
          </div>
          <button className="btn" onClick={lookup} disabled={busy || !config.token}>
            {busy ? "Finding\u2026" : "Find intro-makers"}
          </button>
        </div>
      ) : (
        <p className="muted">Open a LinkedIn profile to find the best intro-makers for that person.</p>
      )}

      {result && (
        <div className="intro-results">
          {result.paths.length === 0 ? (
            <p className="muted">No intro paths yet. Ask teammates to connect their networks.</p>
          ) : (
            result.paths.slice(0, 3).map((p) => (
              <div key={p.connectorId} className="intro-card">
                <div className="intro-card-head">
                  <span className={`intro-badge ${p.veracity}`}>{p.veracity}</span>
                  <span className="intro-score">{p.breakdown.composite}</span>
                </div>
                <ul className="intro-evidence">
                  {p.evidenceSummary.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
