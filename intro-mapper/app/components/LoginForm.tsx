"use client";

import { useState } from "react";

export function LoginForm() {
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org, name, email }),
    });
    if (res.ok) {
      window.location.reload();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Sign in failed");
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: "72px auto 0" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <span className="brand-mark" aria-hidden style={{ width: 44, height: 44, borderRadius: 13 }} />
        <h1 className="page-title" style={{ marginTop: 18, fontSize: 34 }}>
          Find your warmest intro
        </h1>
        <p className="page-sub" style={{ margin: "8px 0 0" }}>
          Map your team&apos;s combined network and rank the best person to make any introduction.
        </p>
      </div>
      <div className="card">
        <form className="stack" onSubmit={submit}>
        <div>
          <label>Team / organization</label>
          <input type="text" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Acme Inc" required />
        </div>
        <div>
          <label>Your name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
        </div>
        <div>
          <label>Work email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" required />
        </div>
        {error && <div className="notice danger">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in\u2026" : "Continue"}
        </button>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Everyone in the same team name shares one graph. This is dev auth &mdash; swap in Clerk for production SSO.
          </p>
        </form>
      </div>
    </div>
  );
}
