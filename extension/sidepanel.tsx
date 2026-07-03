import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  AppSettings,
  ContextFact,
  DraftSet,
  FitTier,
  OutreachRecord,
  ProfileData,
  RecipientSegment,
  SourcingQueueEntry,
  TalentFitScore,
  TalentTrack,
  TouchType,
  DimensionMetrics,
  OutreachEvent,
} from "@whop-copilot/shared";
import { mergeProfileWithOverrides, segmentLabel, shortNameFromFirst } from "@whop-copilot/shared";

import { IntroPaths } from "./intro-paths";
import "./sidepanel.css";

type Tab = "sourcing" | "outreach" | "queue" | "pipeline" | "metrics" | "intro";

const DISCLAIMER_KEY = "tos_disclaimer_accepted";

async function send<T>(msg: Record<string, unknown>): Promise<T> {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error ?? "Request failed");
  return res.data as T;
}

interface RawScrape {
  linkedinUrl: string;
  name: string;
  headline: string;
  location: string;
  about: string;
  currentCompany: string;
  currentTitle: string;
  experience: { company: string; title: string; startDate: string; isCurrent: boolean }[];
  education: { school: string; degree: string; startYear?: number; endYear?: number }[];
}

// Runs in the LinkedIn page context via chrome.scripting. Must be fully self-contained.
function scrapeLinkedInDom(): RawScrape {
  const txt = (el: Element | null) => (el && el.textContent ? el.textContent.trim() : "");
  const q1 = (sels: string[]) => {
    for (const s of sels) {
      const e = document.querySelector(s);
      if (e) return e;
    }
    return null;
  };
  const sectionByAnchor = (id: string) =>
    [...document.querySelectorAll("section")].find((s) => s.querySelector(`#${id}`)) ?? null;

  const name = txt(q1(["main h1", "h1.text-heading-xlarge", "h1.inline.t-24", "h1"])) || "Unknown";
  const headline = txt(
    q1([
      "main .text-body-medium.break-words",
      ".pv-text-details__left-panel .text-body-medium",
      "main .text-body-medium",
    ]),
  );
  const location = txt(
    q1([
      "main .text-body-small.inline.t-black--light",
      ".pv-text-details__left-panel .text-body-small.inline",
    ]),
  );

  let about = "";
  const aboutSection = sectionByAnchor("about");
  if (aboutSection) about = txt(aboutSection.querySelector("span[aria-hidden='true']"));

  const parseList = (section: Element | null, max: number) => {
    if (!section) return [] as string[][];
    const items = [
      ...section.querySelectorAll("li.artdeco-list__item, li.pvs-list__paged-list-item"),
    ];
    return items.slice(0, max).map((li) =>
      [...li.querySelectorAll("span[aria-hidden='true']")]
        .map((s) => (s.textContent || "").trim())
        .filter(Boolean),
    );
  };

  const experience: RawScrape["experience"] = [];
  for (const spans of parseList(sectionByAnchor("experience"), 12)) {
    if (spans.length < 2) continue;
    const title = spans[0];
    const company = (spans[1] || "").split("·")[0].trim();
    const dateStr = spans.find((x) => /\b(19|20)\d{2}\b|present/i.test(x)) || "";
    if (!title || !company) continue;
    experience.push({ company, title, startDate: dateStr, isCurrent: /present/i.test(dateStr) });
  }

  const education: RawScrape["education"] = [];
  for (const spans of parseList(sectionByAnchor("education"), 6)) {
    if (!spans.length) continue;
    const years = (spans.join(" ").match(/(19|20)\d{2}/g) || []).map(Number);
    education.push({
      school: spans[0],
      degree: spans[1] || "",
      startYear: years.length ? Math.min(...years) : undefined,
      endYear: years.length ? Math.max(...years) : undefined,
    });
  }

  const current = experience.find((e) => e.isCurrent) ?? experience[0];
  return {
    linkedinUrl: window.location.href.split("?")[0],
    name,
    headline,
    location,
    about,
    currentCompany: current ? current.company : "",
    currentTitle: current ? current.title : "",
    experience,
    education,
  };
}

function rawToProfile(raw: RawScrape): ProfileData {
  const firstName = raw.name.split(/\s+/)[0] || raw.name;
  const hasName = raw.name !== "Unknown" && !!raw.name.trim();
  const hasExp = raw.experience.length > 0;
  const scrapeHealth: ProfileData["scrapeHealth"] = hasName
    ? hasExp || raw.headline
      ? hasExp
        ? "full"
        : "partial"
      : "partial"
    : "failed";
  return {
    linkedinUrl: raw.linkedinUrl,
    name: raw.name,
    firstName,
    shortName: shortNameFromFirst(firstName),
    headline: raw.headline,
    currentCompany: raw.currentCompany,
    currentTitle: raw.currentTitle,
    location: raw.location,
    about: raw.about,
    education: raw.education,
    experience: raw.experience,
    scrapeHealth,
  };
}

async function scrapeProfile(): Promise<ProfileData | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes("linkedin.com/in/")) return null;
  // Primary: inject the scrape directly so it works even on tabs opened before install.
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeLinkedInDom,
    });
    const raw = res?.result as RawScrape | undefined;
    if (raw && raw.name !== "Unknown") return rawToProfile(raw);
    if (raw) return rawToProfile(raw);
  } catch {
    // fall through to content-script messaging
  }
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PROFILE" });
    return r?.data ?? null;
  } catch {
    return null;
  }
}

function tierColor(tier: FitTier): string {
  if (tier === "strong") return "#22c55e";
  if (tier === "good") return "#eab308";
  if (tier === "disqualified") return "#ef4444";
  return "#94a3b8";
}

function IndexSidepanel() {
  const [tab, setTab] = useState<Tab>("sourcing");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [segment, setSegment] = useState<RecipientSegment | null>(null);
  const [fit, setFit] = useState<TalentFitScore | null>(null);
  const [track, setTrack] = useState<TalentTrack>("engineering");
  const [notes, setNotes] = useState("");
  const [manual, setManual] = useState({ name: "", company: "", title: "", headline: "" });
  const [segmentOverride, setSegmentOverride] = useState<Partial<RecipientSegment>>({});
  const [queue, setQueue] = useState<SourcingQueueEntry[]>([]);
  const [drafts, setDrafts] = useState<DraftSet | null>(null);
  const [draftWarnings, setDraftWarnings] = useState<string[]>([]);
  const [context, setContext] = useState<ContextFact[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [activeRecord, setActiveRecord] = useState<OutreachRecord | null>(null);
  const [outreach, setOutreach] = useState<OutreachRecord[]>([]);
  const [metrics, setMetrics] = useState<DimensionMetrics[]>([]);
  const [events, setEvents] = useState<OutreachEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editDraft, setEditDraft] = useState({ initial: "", followUp1: "", followUp2: "" });
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(true);
  const manualRef = useRef(manual);
  const notesRef = useRef(notes);
  const segmentOverrideRef = useRef(segmentOverride);

  manualRef.current = manual;
  notesRef.current = notes;
  segmentOverrideRef.current = segmentOverride;

  const loadSettings = useCallback(async () => {
    const s = await send<AppSettings>({ type: "GET_SETTINGS" });
    setSettings(s);
    setTrack(s.activeTrack);
  }, []);

  const scoreCurrentProfile = useCallback(
    async (p: ProfileData, activeTrack: TalentTrack) => {
      const merged = mergeProfileWithOverrides(p, manualRef.current);
      const override = segmentOverrideRef.current;
      const { fit: f, segment: seg } = await send<{ fit: TalentFitScore; segment: RecipientSegment }>({
        type: "SCORE_PROFILE",
        track: activeTrack,
        notes: notesRef.current,
        profile: merged,
        segmentOverride: Object.keys(override).length ? override : undefined,
      });
      setProfile(merged);
      setFit(f);
      setSegment(seg);
      setContext([]);
    },
    [],
  );

  const fetchContext = useCallback(async () => {
    if (!profile) return;
    setError("");
    setContextLoading(true);
    try {
      const facts = await send<ContextFact[]>({ type: "FETCH_CONTEXT", profile });
      setContext(facts);
      if (facts.length === 0) {
        setError("No context found for this profile. Try adding company/title, or proceed without it.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setContextLoading(false);
    }
  }, [profile]);

  const toggleContext = useCallback((id: string) => {
    setContext((prev) => prev.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
  }, []);

  const refreshProfile = useCallback(async () => {
    setError("");
    const p = await scrapeProfile();
    if (!p) {
      setError("Open a LinkedIn profile (/in/username) to scrape. Refresh the page if the extension was just installed.");
      return;
    }
    await scoreCurrentProfile(p, track);
  }, [track, scoreCurrentProfile]);

  const enrichCurrentProfile = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = t?.url;
      if (!url || !url.includes("linkedin.com/in/")) {
        setError("Open a LinkedIn profile (/in/username) to enrich via API.");
        return;
      }
      const p = await send<ProfileData>({ type: "ENRICH_PROFILE", url });
      await scoreCurrentProfile(p, track);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [track, scoreCurrentProfile]);

  const loadQueue = useCallback(async () => {
    setQueue(await send<SourcingQueueEntry[]>({ type: "GET_QUEUE" }));
  }, []);

  const enrichQueue = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await send<{ queue: SourcingQueueEntry[]; enriched: number; failures: string[] }>({
        type: "ENRICH_QUEUE",
      });
      setQueue(res.queue);
      if (res.failures.length) {
        setError(`Enriched ${res.enriched}. ${res.failures.length} failed: ${res.failures[0]}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOutreach = useCallback(async () => {
    setOutreach(await send<OutreachRecord[]>({ type: "GET_OUTREACH" }));
  }, []);

  const loadMetrics = useCallback(async () => {
    const data = await send<{ events: OutreachEvent[]; metrics: DimensionMetrics[] }>({ type: "GET_METRICS" });
    setEvents(data.events);
    setMetrics(data.metrics);
  }, []);

  useEffect(() => {
    chrome.storage.local.get(DISCLAIMER_KEY).then((r) => {
      setDisclaimerAccepted(!!r[DISCLAIMER_KEY]);
    });
    loadSettings();
    loadQueue();
    loadOutreach();
    loadMetrics();
    refreshProfile();
  }, [loadSettings, loadQueue, loadOutreach, loadMetrics, refreshProfile]);

  useEffect(() => {
    const onNav = (msg: { type?: string }) => {
      if (msg.type === "PROFILE_NAVIGATED") refreshProfile();
    };
    chrome.runtime.onMessage.addListener(onNav);
    return () => chrome.runtime.onMessage.removeListener(onNav);
  }, [refreshProfile]);

  useEffect(() => {
    if (profile) scoreCurrentProfile(profile, track);
  }, [track]);

  const acceptDisclaimer = async () => {
    await chrome.storage.local.set({ [DISCLAIMER_KEY]: true });
    setDisclaimerAccepted(true);
  };

  const canGenerate =
    profile &&
    profile.name !== "Unknown" &&
    (profile.scrapeHealth !== "failed" || manual.name || manual.company || manual.title);

  const addToQueue = async () => {
    if (!profile || !fit || !segment) return;
    await send({
      type: "ADD_TO_QUEUE",
      entry: {
        id: crypto.randomUUID(),
        profile,
        segment,
        fitScore: fit,
        track,
        notes,
        outreachStatus: "not_contacted",
        addedAt: new Date().toISOString(),
      },
    });
    await loadQueue();
  };

  const generate = async () => {
    if (!profile || !segment || !settings) return;
    setLoading(true);
    setError("");
    setDraftWarnings([]);
    try {
      const data = await send<{ drafts: DraftSet; record: OutreachRecord; validationWarnings?: string[] }>({
        type: "GENERATE_DRAFTS",
        persona: settings.activePersona,
        track,
        notes,
        profile,
        segment,
        founderVariant: settings.founderVariant,
        personalStructure: settings.personalStructure,
        context,
      });
      setDrafts(data.drafts);
      setEditDraft(data.drafts);
      setDraftWarnings(data.validationWarnings ?? []);
      setActiveRecord(data.record);
      setTab("outreach");
      await loadOutreach();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const insertDraft = async (text: string) => {
    if (!text.trim()) {
      setError("Draft is empty");
      return;
    }
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t?.id) return;
    try {
      const res = await chrome.tabs.sendMessage(t.id, { type: "PREFILL_COMPOSE", text });
      if (!res?.ok) setError(res?.error ?? "Could not prefill compose — open LinkedIn messaging first");
    } catch {
      setError("Could not reach LinkedIn tab. Open messaging on linkedin.com and try again.");
    }
  };

  const markSent = async (touchType: TouchType) => {
    if (!activeRecord) return;
    const text =
      touchType === "initial"
        ? editDraft.initial
        : touchType === "follow_up_1"
          ? editDraft.followUp1
          : editDraft.followUp2;
    if (!text.trim()) {
      setError("Cannot mark empty message as sent");
      return;
    }
    try {
      await send({
        type: "MARK_SENT",
        outreachId: activeRecord.id,
        touchType,
        sentText: text,
      });
      await loadOutreach();
      await loadMetrics();
      const updated = await send<OutreachRecord[]>({ type: "GET_OUTREACH" });
      setActiveRecord(updated.find((o) => o.id === activeRecord.id) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const markReply = async (positive: boolean) => {
    if (!activeRecord) return;
    await send({ type: "MARK_REPLY", outreachId: activeRecord.id, positive });
    await loadOutreach();
    await loadMetrics();
  };

  const dueToday = outreach.filter(
    (o) =>
      o.nextFollowUpDue &&
      new Date(o.nextFollowUpDue) <= new Date() &&
      !["replied", "positive_reply", "closed"].includes(o.status),
  );

  if (!disclaimerAccepted) {
    return (
      <div className="panel">
        <h1>Whop Talent Co-pilot</h1>
        <div className="card">
          <p>
            This extension scrapes LinkedIn profile pages you open manually and drafts messages for you to review and
            send yourself. It does not auto-send. LinkedIn&apos;s Terms of Service may restrict automated data
            collection — you are responsible for compliant use.
          </p>
          <button className="btn primary" onClick={acceptDisclaimer}>
            I understand — continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <header className="header">
        <h1>Whop Talent Co-pilot</h1>
        {settings && (
          <div className="persona-toggle">
            <button
              className={settings.activePersona === "personal" ? "active" : ""}
              onClick={() =>
                send({ type: "SAVE_SETTINGS", settings: { activePersona: "personal" } }).then(loadSettings)
              }
            >
              Personal
            </button>
            <button
              className={settings.activePersona === "founder" ? "active" : ""}
              onClick={() =>
                send({ type: "SAVE_SETTINGS", settings: { activePersona: "founder" } }).then(loadSettings)
              }
            >
              Founder
            </button>
          </div>
        )}
      </header>

      <nav className="tabs">
        {(["sourcing", "outreach", "queue", "pipeline", "metrics", "intro"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
            {t === "pipeline" && dueToday.length > 0 ? ` (${dueToday.length})` : ""}
          </button>
        ))}
      </nav>

      {error && <div className="error">{error}</div>}

      {tab === "sourcing" && (
        <section className="section">
          {settings?.activePersona === "personal" && (
            <div className="track-toggle">
              <button
                className={settings.personalStructure === "personal_full" ? "active" : ""}
                onClick={() =>
                  send({ type: "SAVE_SETTINGS", settings: { personalStructure: "personal_full" } }).then(loadSettings)
                }
              >
                Structure A (full)
              </button>
              <button
                className={settings.personalStructure === "personal_obs_only" ? "active" : ""}
                onClick={() =>
                  send({ type: "SAVE_SETTINGS", settings: { personalStructure: "personal_obs_only" } }).then(loadSettings)
                }
              >
                Structure B (obs only)
              </button>
            </div>
          )}
          <div className="track-toggle">
            <button className={track === "gtm" ? "active" : ""} onClick={() => setTrack("gtm")}>
              GTM (&lt;30)
            </button>
            <button className={track === "engineering" ? "active" : ""} onClick={() => setTrack("engineering")}>
              Eng (&lt;45)
            </button>
          </div>
          <div className="row">
            <button className="btn secondary" onClick={refreshProfile}>
              Re-scrape profile
            </button>
            {settings && settings.enrichmentProvider !== "none" && (
              <button className="btn secondary" onClick={enrichCurrentProfile} disabled={loading}>
                {loading ? "Enriching…" : "Enrich via API"}
              </button>
            )}
          </div>
          {profile && profile.scrapeHealth !== "full" && (
            <div className="card">
              <div className="card-title">Manual override (scrape {profile.scrapeHealth})</div>
              <label>
                Name
                <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder={profile.name} />
              </label>
              <label>
                Company
                <input value={manual.company} onChange={(e) => setManual({ ...manual, company: e.target.value })} placeholder={profile.currentCompany} />
              </label>
              <label>
                Title
                <input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder={profile.currentTitle} />
              </label>
              <button className="btn secondary" onClick={refreshProfile}>
                Apply overrides
              </button>
            </div>
          )}
          {profile && (
            <div className="card">
              <div className="profile-name">{profile.name}</div>
              <div className="muted">{profile.headline}</div>
              <div className="muted">{profile.currentTitle} @ {profile.currentCompany}</div>
              <div className="muted">Scrape: {profile.scrapeHealth}</div>
              {segment && <div className="badge">{segmentLabel(segment)}</div>}
            </div>
          )}
          {segment && (
            <div className="card">
              <div className="card-title">Segment (editable)</div>
              <label>
                Role family
                <select
                  value={segmentOverride.roleFamily ?? segment.roleFamily}
                  onChange={(e) => setSegmentOverride({ ...segmentOverride, roleFamily: e.target.value as RecipientSegment["roleFamily"] })}
                >
                  {["engineering", "sales", "finance", "product", "design", "ops", "other"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                Age band
                <select
                  value={segmentOverride.ageBand ?? segment.ageBand}
                  onChange={(e) => setSegmentOverride({ ...segmentOverride, ageBand: e.target.value as RecipientSegment["ageBand"] })}
                >
                  {["20s", "30s", "40s", "50s+", "unknown"].map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </label>
              <button className="btn secondary" onClick={refreshProfile}>
                Apply segment
              </button>
            </div>
          )}
          {fit && (
            <div className="card" style={{ borderColor: tierColor(fit.tier) }}>
              <div className="score">
                Fit: <strong>{fit.score}</strong> — {fit.tier.toUpperCase()}
              </div>
              <div className="muted">
                Age: ~{fit.ageGate.inferred ?? "?"} (max {fit.ageGate.max})
              </div>
              <ul className="signals">
                {fit.matchedSignals.map((s) => (
                  <li key={s}>✓ {s}</li>
                ))}
                {fit.missingSignals.slice(0, 4).map((s) => (
                  <li key={s} className="muted">
                    ○ {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label>
            Notes (signals scrape missed — IOI gold, President&apos;s Club, etc.)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          {settings && settings.contextProvider !== "none" && profile && (
            <div className="card">
              <div className="card-title">
                Live context
                <button className="btn secondary" onClick={fetchContext} disabled={contextLoading}>
                  {contextLoading ? "Fetching…" : context.length ? "Refresh" : "Fetch context"}
                </button>
              </div>
              {context.length === 0 ? (
                <p className="muted">
                  Pull recent news, funding, and posts. Review each item — only checked facts are
                  given to the model.
                </p>
              ) : (
                <ul className="context-list">
                  {context.map((c) => (
                    <li key={c.id} className={c.enabled ? "ctx on" : "ctx off"}>
                      <label className="ctx-row">
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          onChange={() => toggleContext(c.id)}
                        />
                        <span>
                          <span className="ctx-meta">
                            {c.type}
                            {c.date ? ` · ${c.date}` : ""} ·{" "}
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noreferrer">
                                {c.source}
                              </a>
                            ) : (
                              c.source
                            )}
                          </span>
                          <span className="ctx-text">{c.text}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="actions">
            <button className="btn secondary" onClick={addToQueue} disabled={!fit}>
              Add to Queue
            </button>
            <button className="btn primary" onClick={generate} disabled={loading || !canGenerate}>
              {loading ? "Generating…" : "Generate Outreach →"}
            </button>
          </div>
          {!canGenerate && profile && (
            <p className="muted">Add manual name/company/title when scrape fails before generating.</p>
          )}
        </section>
      )}

      {tab === "outreach" && drafts && (
        <section className="section">
          {draftWarnings.length > 0 && (
            <div className="warning">
              <strong>Review before sending:</strong>
              <ul>
                {draftWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {(["initial", "followUp1", "followUp2"] as const).map((key, i) => {
            const touch: TouchType = i === 0 ? "initial" : i === 1 ? "follow_up_1" : "follow_up_2";
            const label = i === 0 ? "Initial" : `Follow-up ${i}`;
            return (
              <div key={key} className="card">
                <div className="card-title">
                  {label}
                  {(() => {
                    const words = editDraft[key].trim().split(/\s+/).filter(Boolean).length;
                    const inRange = words >= 50 && words <= 70;
                    return (
                      <span className={inRange ? "wordcount ok" : "wordcount off"}>
                        {words}w {inRange ? "✓" : "(aim 50–70)"}
                      </span>
                    );
                  })()}
                </div>
                <textarea
                  value={editDraft[key]}
                  onChange={(e) => setEditDraft({ ...editDraft, [key]: e.target.value })}
                  rows={6}
                />
                <div className="actions">
                  <button className="btn secondary" onClick={() => navigator.clipboard.writeText(editDraft[key])}>
                    Copy
                  </button>
                  <button className="btn secondary" onClick={() => insertDraft(editDraft[key])}>
                    Insert into LinkedIn
                  </button>
                  <button className="btn primary" onClick={() => markSent(touch)} disabled={!editDraft[key].trim()}>
                    Mark sent
                  </button>
                </div>
              </div>
            );
          })}
          {activeRecord && (
            <div className="actions">
              <button className="btn secondary" onClick={() => markReply(false)}>
                Mark replied
              </button>
              <button className="btn primary" onClick={() => markReply(true)}>
                Mark positive reply
              </button>
            </div>
          )}
        </section>
      )}

      {tab === "outreach" && !drafts && (
        <section className="section">
          <p className="muted">No drafts yet. Score a profile and click Generate Outreach.</p>
        </section>
      )}

      {tab === "queue" && (
        <section className="section">
          {settings && settings.enrichmentProvider !== "none" && queue.length > 0 && (
            <button className="btn secondary" onClick={enrichQueue} disabled={loading}>
              {loading ? "Enriching…" : `Enrich queue via API (${queue.length})`}
            </button>
          )}
          {queue.length === 0 && <p className="muted">Queue empty.</p>}
          {queue.map((q) => (
            <div key={q.id} className="card">
              <div className="profile-name">
                {q.profile.name}{" "}
                <span style={{ color: tierColor(q.fitScore.tier) }}>{q.fitScore.score}</span>
              </div>
              <div className="muted">
                {q.track} · {q.fitScore.tier}
              </div>
              <div className="actions">
                <button
                  className="btn secondary"
                  onClick={() => chrome.tabs.create({ url: q.profile.linkedinUrl })}
                >
                  Open
                </button>
                <button
                  className="btn secondary"
                  onClick={() => send({ type: "REMOVE_FROM_QUEUE", id: q.id }).then(loadQueue)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "pipeline" && (
        <section className="section">
          <h3>Due today ({dueToday.length})</h3>
          {dueToday.map((o) => (
            <div key={o.id} className="card">
              <div className="profile-name">{o.name}</div>
              <div className="muted">{o.status} · {o.persona}</div>
              <button className="btn secondary" onClick={() => chrome.tabs.create({ url: o.linkedinUrl })}>
                Open LinkedIn
              </button>
            </div>
          ))}
          <h3>All active</h3>
          {outreach
            .filter((o) => !["closed"].includes(o.status))
            .map((o) => (
              <div key={o.id} className="card">
                <div className="profile-name">{o.name}</div>
                <div className="muted">
                  {o.status} · {o.track} · {o.persona}
                </div>
              </div>
            ))}
        </section>
      )}

      {tab === "metrics" && (
        <section className="section">
          <div className="summary">
            <div className="stat">
              <div className="stat-val">{events.filter((e) => e.type === "message_sent").length}</div>
              <div className="muted">Sends</div>
            </div>
            <div className="stat">
              <div className="stat-val">{events.filter((e) => e.type === "reply").length}</div>
              <div className="muted">Replies</div>
            </div>
            <div className="stat">
              <div className="stat-val">{events.filter((e) => e.type === "positive_reply").length}</div>
              <div className="muted">Positive</div>
            </div>
          </div>
          <button
            className="btn secondary"
            onClick={async () => {
              const csv = await send<string>({ type: "EXPORT_CSV" });
              const blob = new Blob([csv], { type: "text/csv" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "whop-outreach-events.csv";
              a.click();
            }}
          >
            Export CSV
          </button>
          <table className="metrics-table">
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Value</th>
                <th>n</th>
                <th>Reply%</th>
                <th>Pos%</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m, i) => (
                <tr key={i} className={m.sends < 10 ? "low-sample" : ""}>
                  <td>{m.dimension}</td>
                  <td>{m.value}</td>
                  <td>{m.sends}</td>
                  <td>{(m.replyRate * 100).toFixed(0)}%</td>
                  <td>{(m.positiveRate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {metrics.length === 0 && <p className="muted">No sends logged yet. Mark messages as sent to build metrics.</p>}
        </section>
      )}

      {tab === "intro" && <IntroPaths profile={profile} />}

      <footer className="footer">
        <a href="#" onClick={(e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); }}>
          Options / Style Studio
        </a>
      </footer>
    </div>
  );
}

export default IndexSidepanel;
