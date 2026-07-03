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
    <div className="card" style={{ maxWidth: 420, margin: "60px auto" }}>
      <h1 className="page-title">Sign in</h1>
      <p className="page-sub">
        Join your team&apos;s workspace to find warm intros across everyone&apos;s network.
      </p>
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
  );
}
