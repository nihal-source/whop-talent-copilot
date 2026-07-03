"use client";

import { useEffect, useState } from "react";

interface Member {
  id: string;
  name: string;
  email: string;
  shareWithTeam: boolean;
  introMakerOptIn: boolean;
  edgeCount: number;
  lastSyncDays: number | null;
  stale: boolean;
}

interface TeamData {
  org: { name: string };
  members: Member[];
  totals: { persons: number; edges: number };
}

export function TeamAdmin() {
  const [data, setData] = useState<TeamData | null>(null);

  useEffect(() => {
    fetch("/api/team")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <div className="empty">Loading team&hellip;</div>;

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">{data.org.name} &mdash; team network</h1>
        <p className="page-sub">
          {data.totals.persons} people and {data.totals.edges} relationships in the shared graph.
        </p>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Sharing</th>
              <th>Intro-maker</th>
              <th>Connections</th>
              <th>Last sync</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{m.email}</div>
                </td>
                <td>{m.shareWithTeam ? <span className="badge confirmed">shared</span> : <span className="badge">private</span>}</td>
                <td>{m.introMakerOptIn ? <span className="badge confirmed">opted in</span> : <span className="badge">no</span>}</td>
                <td>{m.edgeCount}</td>
                <td>
                  {m.lastSyncDays == null ? (
                    <span className="muted">never</span>
                  ) : m.stale ? (
                    <span className="badge likely">{m.lastSyncDays}d &mdash; stale</span>
                  ) : (
                    <span>{m.lastSyncDays}d ago</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
