"use client";

import { useEffect, useRef, useState } from "react";

interface Consent {
  shareWithTeam: boolean;
  introMakerOptIn: boolean;
  retentionDays: number;
}

interface UploadSummary {
  files: Array<{ file: string; format: string; parsed: number; skipped: number; warnings: string[] }>;
  added: number;
  merged: number;
  ambiguities: number;
}

export function Onboarding() {
  const [consent, setConsent] = useState<Consent>({ shareWithTeam: false, introMakerOptIn: false, retentionDays: 365 });
  const [saved, setSaved] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [xStatus, setXStatus] = useState<{ kind: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const x = new URLSearchParams(window.location.search).get("x");
    if (x === "ok") setXStatus({ kind: "info", message: "X follows synced into your team graph." });
    else if (x === "consent") setXStatus({ kind: "warn", message: "Accept data-sharing consent before connecting X." });
    else if (x === "error") setXStatus({ kind: "danger", message: "X connection failed. Check the server X app config and try again." });
  }, []);

  useEffect(() => {
    fetch("/api/consent")
      .then((r) => r.json())
      .then((b) => {
        if (b.consent) setConsent({ shareWithTeam: b.consent.shareWithTeam, introMakerOptIn: b.consent.introMakerOptIn, retentionDays: b.consent.retentionDays });
      })
      .catch(() => {});
  }, []);

  async function saveConsent(next: Consent) {
    setConsent(next);
    setSaved(false);
    await fetch("/api/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    setSaved(true);
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!consent.shareWithTeam) {
      setUploadError("Accept the data-sharing consent above before uploading.");
      return;
    }
    setBusy(true);
    setUploadError(null);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("files", f);
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setUploadError(body.message ?? body.error ?? "Upload failed");
    else setSummary(body);
    setBusy(false);
  }

  async function deleteMyData() {
    if (!confirm("Remove all edges you contributed and revoke sharing? This cannot be undone.")) return;
    await fetch("/api/data/delete", { method: "POST" });
    setSummary(null);
    setConsent({ shareWithTeam: false, introMakerOptIn: false, retentionDays: 365 });
  }

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Connect your network</h1>
        <p className="page-sub">
          Upload your own platform exports. We never scrape or ask for passwords &mdash; only data you export yourself.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Consent</h3>
        <div className="toggle-row">
          <input
            type="checkbox"
            checked={consent.shareWithTeam}
            onChange={(e) => saveConsent({ ...consent, shareWithTeam: e.target.checked })}
          />
          <div>
            <div className="t">Share my network with my team</div>
            <div className="d">
              Your connections become intro paths teammates can search. We store relationship metadata
              (who, platform, dates) &mdash; never message contents.
            </div>
          </div>
        </div>
        <div className="toggle-row">
          <input
            type="checkbox"
            checked={consent.introMakerOptIn}
            onChange={(e) => saveConsent({ ...consent, introMakerOptIn: e.target.checked })}
          />
          <div>
            <div className="t">Let teammates see me as an intro-maker</div>
            <div className="d">Others can ask you to forward a warm intro. You approve each one.</div>
          </div>
        </div>
        {saved && <div className="notice info" style={{ marginTop: 12 }}>Consent saved.</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Upload exports</h3>
        <div className="notice info" style={{ marginBottom: 14 }}>
          Supported today: LinkedIn <code>Connections.csv</code>, X archive <code>following.js</code>/<code>follower.js</code>,
          Instagram <code>followers/following .json</code>. See the guide below for how to export each.
        </div>
        <div
          className={`dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Processing\u2026" : "Drop export files here, or click to choose"}
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files)}
          />
        </div>
        {uploadError && <div className="notice danger" style={{ marginTop: 12 }}>{uploadError}</div>}
        {summary && (
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="notice info">
              Added {summary.added} new connections, merged {summary.merged} duplicates
              {summary.ambiguities > 0 ? `, ${summary.ambiguities} need disambiguation` : ""}.
            </div>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Format</th>
                  <th>Parsed</th>
                  <th>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {summary.files.map((f) => (
                  <tr key={f.file}>
                    <td>{f.file}</td>
                    <td>{f.format}</td>
                    <td>{f.parsed}</td>
                    <td>{f.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ExtensionToken />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Connect via OAuth</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Sync your X follows read-only via official OAuth (minimal scopes). Requires an X app
          configured on the server. The LinkedIn EU Data Portability API is next.
        </p>
        {xStatus && (
          <div className={`notice ${xStatus.kind}`} style={{ marginBottom: 12 }}>{xStatus.message}</div>
        )}
        <div className="row">
          <a href="/api/oauth/x/start">
            <button className="secondary" disabled={!consent.shareWithTeam}>Connect X</button>
          </a>
          <button className="ghost" disabled>Connect LinkedIn (EU)</button>
        </div>
        {!consent.shareWithTeam && (
          <p className="muted" style={{ marginTop: 8 }}>Accept data-sharing consent above to enable.</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Your data</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Delete everything you&apos;ve contributed and revoke sharing at any time.
        </p>
        <button className="danger" onClick={deleteMyData}>Delete my data & opt out</button>
      </div>
    </div>
  );
}

function ExtensionToken() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    const res = await fetch("/api/token");
    const body = await res.json().catch(() => ({}));
    if (res.ok) setToken(body.token);
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Connect the Chrome extension</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Paste this access token into the LinkedIn Co-pilot extension (Intro Paths &rarr; Setup) so it
        can look up intro-makers while you browse LinkedIn.
      </p>
      {token ? (
        <div className="row">
          <input type="text" readOnly value={token} onFocus={(e) => e.currentTarget.select()} />
          <button
            className="secondary"
            onClick={() => {
              navigator.clipboard?.writeText(token);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button className="secondary" onClick={reveal}>Reveal token</button>
      )}
    </div>
  );
}
