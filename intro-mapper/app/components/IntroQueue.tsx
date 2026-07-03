"use client";

import { useEffect, useState } from "react";

type Status = "queued" | "sent" | "accepted" | "declined" | "no_response";

interface QueueItem {
  id: string;
  targetName: string;
  connectorName: string;
  status: Status;
  draft?: string;
  createdAt: string;
}

const NEXT: Record<Status, Status[]> = {
  queued: ["sent"],
  sent: ["accepted", "declined", "no_response"],
  accepted: [],
  declined: [],
  no_response: [],
};

export function IntroQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch("/api/intro");
    const body = await res.json().catch(() => ({ requests: [] }));
    setItems(body.requests ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: Status) {
    await fetch("/api/intro/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    load();
  }

  if (loading) return <div className="empty">Loading queue&hellip;</div>;

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Intro queue</h1>
        <p className="page-sub">
          Track the intros you&apos;ve asked for. Outcomes feed each connector&apos;s responsiveness score.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          No intro requests yet. Find a target and draft an ask from the <strong>Find intros</strong> page.
        </div>
      ) : (
        <div className="stack">
          {items.map((item) => (
            <div key={item.id} className="path-card">
              <div className="path-head">
                <div>
                  <div className="connector-name">
                    {item.connectorName} &rarr; {item.targetName}
                  </div>
                  <div className="connector-sub">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <span className={`badge ${item.status === "accepted" ? "confirmed" : item.status === "declined" ? "" : "likely"}`}>
                  {item.status.replace("_", " ")}
                </span>
              </div>
              {item.draft && <div className="notice info" style={{ whiteSpace: "pre-wrap" }}>{item.draft}</div>}
              {NEXT[item.status].length > 0 && (
                <div className="row">
                  {NEXT[item.status].map((s) => (
                    <button key={s} className="secondary" onClick={() => setStatus(item.id, s)}>
                      Mark {s.replace("_", " ")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
