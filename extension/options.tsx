import { useEffect, useState } from "react";

import type { AppSettings, TalentBarConfig } from "@whop-copilot/shared";

import "./options.css";

async function send<T>(msg: Record<string, unknown>): Promise<T> {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error ?? "Failed");
  return res.data as T;
}

function OptionsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [tab, setTab] = useState<"api" | "talent" | "style">("api");
  const [saved, setSaved] = useState(false);
  const [companyInput, setCompanyInput] = useState("");

  useEffect(() => {
    send<AppSettings>({ type: "GET_SETTINGS" }).then(setSettings);
  }, []);

  const save = async () => {
    if (!settings) return;
    await send({ type: "SAVE_SETTINGS", settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!settings) return <div className="options">Loading…</div>;

  const updateTalent = (patch: Partial<TalentBarConfig>) => {
    setSettings({ ...settings, talentBar: { ...settings.talentBar, ...patch } });
  };

  const addCompanies = (key: keyof Pick<TalentBarConfig, "engineeringCompanies" | "chineseCompanies" | "preSeriesCCompanies" | "gtmSalesCompanies">) => {
    const names = companyInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    updateTalent({ [key]: [...settings.talentBar[key], ...names] });
    setCompanyInput("");
  };

  return (
    <div className="options">
      <h1>Whop Talent Co-pilot — Settings</h1>
      {saved && <div className="saved">Saved ✓</div>}

      <nav className="opt-tabs">
        {(["api", "talent", "style"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "api" ? "API Key" : t === "talent" ? "Talent Bar" : "Style Studio"}
          </button>
        ))}
      </nav>

      {tab === "api" && (
        <section>
          <label>
            Anthropic API Key
            <input
              type="password"
              value={settings.anthropicApiKey}
              onChange={(e) => setSettings({ ...settings, anthropicApiKey: e.target.value })}
            />
          </label>
          <p className="hint">Stored locally in chrome.storage. Never shared except with Anthropic API.</p>

          <label>
            Profile Enrichment Provider
            <select
              value={settings.enrichmentProvider}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  enrichmentProvider: e.target.value as AppSettings["enrichmentProvider"],
                })
              }
            >
              <option value="none">None — scrape the open LinkedIn tab (free)</option>
              <option value="apify">Apify — real-time LinkedIn enricher (URL → data)</option>
            </select>
          </label>
          <p className="hint">
            Optional. With a provider set, you can pull full profile data from just a URL and
            bulk-enrich your whole queue without opening each profile.
          </p>

          {settings.enrichmentProvider === "apify" && (
            <>
              <label>
                Apify API Token
                <input
                  type="password"
                  value={settings.enrichmentApiToken}
                  onChange={(e) =>
                    setSettings({ ...settings, enrichmentApiToken: e.target.value })
                  }
                />
              </label>
              <p className="hint">
                Uses the no-cookie LinkedIn Profile Enricher actor (public data only, pay per
                result). Get a token at apify.com → Settings → Integrations.
              </p>
            </>
          )}
        </section>
      )}

      {tab === "talent" && (
        <section>
          <div className="row">
            <label>
              GTM age cap
              <input
                type="number"
                value={settings.talentBar.gtmAgeCap}
                onChange={(e) => updateTalent({ gtmAgeCap: +e.target.value })}
              />
            </label>
            <label>
              Engineering age cap
              <input
                type="number"
                value={settings.talentBar.engineeringAgeCap}
                onChange={(e) => updateTalent({ engineeringAgeCap: +e.target.value })}
              />
            </label>
          </div>

          <h3>Company lists</h3>
          <input
            placeholder="Add companies (comma-separated)"
            value={companyInput}
            onChange={(e) => setCompanyInput(e.target.value)}
          />
          <div className="btn-row">
            <button onClick={() => addCompanies("engineeringCompanies")}>+ Eng tier-1</button>
            <button onClick={() => addCompanies("chineseCompanies")}>+ Chinese</button>
            <button onClick={() => addCompanies("preSeriesCCompanies")}>+ Pre-Series C</button>
            <button onClick={() => addCompanies("gtmSalesCompanies")}>+ GTM sales</button>
          </div>

          <div className="lists">
            <div>
              <strong>Eng ({settings.talentBar.engineeringCompanies.length})</strong>
              <div className="chips">
                {settings.talentBar.engineeringCompanies.map((c) => (
                  <span key={c} className="chip">{c}</span>
                ))}
              </div>
            </div>
            <div>
              <strong>Chinese ({settings.talentBar.chineseCompanies.length})</strong>
              <div className="chips">
                {settings.talentBar.chineseCompanies.map((c) => (
                  <span key={c} className="chip">{c}</span>
                ))}
              </div>
            </div>
            <div>
              <strong>Pre-Series C ({settings.talentBar.preSeriesCCompanies.length})</strong>
              <p className="hint">Startup = below Series C. Add companies as you source.</p>
            </div>
          </div>

          <h3>GTM signal weights</h3>
          {Object.entries(settings.talentBar.gtmWeights).map(([k, v]) => (
            <label key={k}>
              {k}
              <input
                type="number"
                value={v}
                onChange={(e) =>
                  updateTalent({ gtmWeights: { ...settings.talentBar.gtmWeights, [k]: +e.target.value } })
                }
              />
            </label>
          ))}
        </section>
      )}

      {tab === "style" && (
        <section>
          {(["personal", "founder"] as const).map((personaId) => {
            const p = settings.personas[personaId];
            return (
              <div key={personaId} className="persona-block">
                <h3>{p.label} persona</h3>
                <label>
                  Tone
                  <textarea
                    rows={2}
                    value={p.styleGuide.tone}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        personas: {
                          ...settings.personas,
                          [personaId]: {
                            ...p,
                            styleGuide: { ...p.styleGuide, tone: e.target.value },
                          },
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Example initial
                  <textarea
                    rows={5}
                    value={p.examples.initial}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        personas: {
                          ...settings.personas,
                          [personaId]: {
                            ...p,
                            examples: { ...p.examples, initial: e.target.value },
                          },
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Must avoid
                  <textarea
                    rows={2}
                    value={p.styleGuide.mustAvoid.join(", ")}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        personas: {
                          ...settings.personas,
                          [personaId]: {
                            ...p,
                            styleGuide: {
                              ...p.styleGuide,
                              mustAvoid: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                            },
                          },
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Example follow-up 1
                  <textarea
                    rows={3}
                    value={p.examples.followUp1}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        personas: {
                          ...settings.personas,
                          [personaId]: {
                            ...p,
                            examples: { ...p.examples, followUp1: e.target.value },
                          },
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Sender name
                  <input
                    value={p.senderContext.name}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        personas: {
                          ...settings.personas,
                          [personaId]: {
                            ...p,
                            senderContext: { ...p.senderContext, name: e.target.value },
                          },
                        },
                      })
                    }
                  />
                </label>
              </div>
            );
          })}

          <h3>Founder variant default</h3>
          <select
            value={settings.founderVariant}
            onChange={(e) =>
              setSettings({ ...settings, founderVariant: e.target.value as AppSettings["founderVariant"] })
            }
          >
            <option value="founder_cracked">Cracked</option>
            <option value="founder_subtle_career">Subtle career</option>
            <option value="founder_subtle_lit">Subtle lit</option>
            <option value="founder_direct">Direct + Whop pitch</option>
          </select>
        </section>
      )}

      <button className="save-btn" onClick={save}>
        Save settings
      </button>
    </div>
  );
}

export default OptionsPage;
