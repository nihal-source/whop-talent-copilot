import {
  DEFAULT_PERSONAS,
  DEFAULT_TALENT_BAR,
  aggregateMetrics,
  buildRecipientSegment,
  buildSystemPrompt,
  buildUserPrompt,
  callAnthropic,
  enrichProfile,
  extractMessageFeatures,
  isProfileReadyForGeneration,
  levenshtein,
  sanitizeSentText,
  scoreProfile,
  validateDraftSet,
  type AppSettings,
  type OutreachEvent,
  type OutreachPersona,
  type OutreachRecord,
  type ProfileData,
  type SourcingQueueEntry,
} from "@whop-copilot/shared";

const SETTINGS_KEY = "app_settings";
const QUEUE_KEY = "sourcing_queue";
const OUTREACH_KEY = "outreach_records";
const EVENTS_KEY = "outreach_events";

export const DEFAULT_SETTINGS: AppSettings = {
  anthropicApiKey: "",
  enrichmentProvider: "none",
  enrichmentApiToken: "",
  activePersona: "personal",
  activeTrack: "engineering",
  founderVariant: "founder_subtle_career",
  personalStructure: "personal_full",
  talentBar: DEFAULT_TALENT_BAR,
  personas: DEFAULT_PERSONAS,
  frameworkVersion: "v1",
};

async function getSettings(): Promise<AppSettings> {
  const { [SETTINGS_KEY]: s } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s as AppSettings | undefined) };
}

async function saveSettings(settings: AppSettings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function getQueue(): Promise<SourcingQueueEntry[]> {
  const { [QUEUE_KEY]: q } = await chrome.storage.local.get(QUEUE_KEY);
  return (q as SourcingQueueEntry[]) ?? [];
}

async function saveQueue(queue: SourcingQueueEntry[]) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function getOutreach(): Promise<OutreachRecord[]> {
  const { [OUTREACH_KEY]: o } = await chrome.storage.local.get(OUTREACH_KEY);
  return (o as OutreachRecord[]) ?? [];
}

async function saveOutreach(records: OutreachRecord[]) {
  await chrome.storage.local.set({ [OUTREACH_KEY]: records });
}

async function getLocalEvents(): Promise<OutreachEvent[]> {
  const local = await chrome.storage.local.get(EVENTS_KEY);
  return (local[EVENTS_KEY] as OutreachEvent[]) ?? [];
}

async function getEvents(): Promise<OutreachEvent[]> {
  const localEvents = await getLocalEvents();
  try {
    const res = await fetch("http://localhost:3456/api/events");
    if (res.ok) {
      const remote = (await res.json()) as OutreachEvent[];
      const byId = new Map<string, OutreachEvent>();
      for (const e of [...localEvents, ...remote]) byId.set(e.id, e);
      return [...byId.values()];
    }
  } catch {
    // server optional
  }
  return localEvents;
}

async function logEvent(event: Omit<OutreachEvent, "id">) {
  const full: OutreachEvent = { ...event, id: crypto.randomUUID() };
  const localEvents = await getLocalEvents();
  localEvents.push(full);
  await chrome.storage.local.set({ [EVENTS_KEY]: localEvents });
  try {
    await fetch("http://localhost:3456/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(full),
    });
  } catch {
    // server optional
  }
  return full;
}

function getTopPerformers(events: OutreachEvent[], segmentKey: string, limit = 3): string[] {
  return events
    .filter((e) => e.type === "message_sent" && e.recipientSegment.segmentKey === segmentKey)
    .slice(-20)
    .map((e) => e.sentText)
    .slice(0, limit);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const settings = await getSettings();

      switch (msg.type) {
        case "GET_SETTINGS":
          sendResponse({ ok: true, data: settings });
          break;

        case "SAVE_SETTINGS": {
          const patch = msg.settings as Partial<AppSettings> | undefined;
          const merged: AppSettings = { ...settings, ...patch };
          if (patch?.personas) {
            merged.personas = {
              personal: patch.personas.personal
                ? { ...settings.personas.personal, ...patch.personas.personal }
                : settings.personas.personal,
              founder: patch.personas.founder
                ? { ...settings.personas.founder, ...patch.personas.founder }
                : settings.personas.founder,
            };
          }
          if (patch?.talentBar) {
            merged.talentBar = { ...settings.talentBar, ...patch.talentBar };
          }
          await saveSettings(merged);
          sendResponse({ ok: true });
          break;
        }

        case "ENRICH_PROFILE": {
          if (settings.enrichmentProvider === "none") {
            sendResponse({ ok: false, error: "No enrichment provider configured in Options" });
            break;
          }
          const url = (msg.url as string | undefined)?.trim();
          if (!url || !/linkedin\.com\/in\//.test(url)) {
            sendResponse({ ok: false, error: "A valid LinkedIn profile URL is required" });
            break;
          }
          const profile = await enrichProfile(
            settings.enrichmentProvider,
            settings.enrichmentApiToken,
            url,
          );
          sendResponse({ ok: true, data: profile });
          break;
        }

        case "ENRICH_QUEUE": {
          if (settings.enrichmentProvider === "none") {
            sendResponse({ ok: false, error: "No enrichment provider configured in Options" });
            break;
          }
          const queue = await getQueue();
          let enriched = 0;
          const failures: string[] = [];
          for (const entry of queue) {
            const url = entry.profile.linkedinUrl?.trim();
            if (!url || !/linkedin\.com\/in\//.test(url)) continue;
            // Skip entries that already look complete unless a re-enrich is forced.
            if (!msg.force && entry.profile.scrapeHealth === "full" && entry.profile.experience.length) {
              continue;
            }
            try {
              const fresh = await enrichProfile(
                settings.enrichmentProvider,
                settings.enrichmentApiToken,
                url,
              );
              entry.profile = fresh;
              entry.fitScore = scoreProfile(fresh, entry.track, settings.talentBar, entry.notes ?? "");
              entry.segment = buildRecipientSegment(fresh);
              enriched++;
            } catch (err) {
              failures.push(`${entry.profile.name || url}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          queue.sort((a, b) => b.fitScore.score - a.fitScore.score);
          await saveQueue(queue);
          sendResponse({ ok: true, data: { queue, enriched, failures } });
          break;
        }

        case "SCORE_PROFILE": {
          const profile = msg.profile as ProfileData;
          const fit = scoreProfile(profile, msg.track, settings.talentBar, msg.notes ?? "");
          const segment = buildRecipientSegment(profile, msg.segmentOverride);
          sendResponse({ ok: true, data: { fit, segment } });
          break;
        }

        case "ADD_TO_QUEUE": {
          const queue = await getQueue();
          const entry: SourcingQueueEntry = msg.entry;
          if (!queue.find((q) => q.profile.linkedinUrl === entry.profile.linkedinUrl)) {
            queue.push(entry);
            queue.sort((a, b) => b.fitScore.score - a.fitScore.score);
            await saveQueue(queue);
          }
          sendResponse({ ok: true, data: queue });
          break;
        }

        case "GET_QUEUE":
          sendResponse({ ok: true, data: await getQueue() });
          break;

        case "REMOVE_FROM_QUEUE": {
          const queue = (await getQueue()).filter((q) => q.id !== msg.id);
          await saveQueue(queue);
          sendResponse({ ok: true, data: queue });
          break;
        }

        case "GENERATE_DRAFTS": {
          if (!settings.anthropicApiKey) {
            sendResponse({ ok: false, error: "Add Anthropic API key in Options" });
            break;
          }
          const profile = msg.profile as ProfileData;
          const readiness = isProfileReadyForGeneration(profile);
          if (!readiness.ok) {
            sendResponse({ ok: false, error: readiness.reason });
            break;
          }
          const segment = msg.segment ?? buildRecipientSegment(profile);
          const personaId = msg.persona as OutreachPersona;
          const persona = settings.personas[personaId];
          const founderVariant = msg.founderVariant ?? settings.founderVariant;
          const allowWhopProof = personaId !== "founder" || founderVariant === "founder_direct";
          const events = await getEvents();
          const topPerformers = getTopPerformers(events, segment.segmentKey);

          const system = buildSystemPrompt(
            persona,
            segment,
            msg.track,
            founderVariant,
            msg.personalStructure ?? settings.personalStructure,
          );
          const user = buildUserPrompt(profile, segment, msg.notes ?? "", "initial", topPerformers, {
            allowWhopProof,
          });
          const drafts = await callAnthropic(settings.anthropicApiKey, system, user);

          const validation = validateDraftSet(drafts, profile, msg.notes ?? "", {
            personaIsFounder: msg.persona === "founder",
            founderVariant,
          });
          if (!validation.valid) {
            sendResponse({ ok: false, error: validation.errors.join("; ") });
            break;
          }

          const record: OutreachRecord = {
            id: crypto.randomUUID(),
            persona: personaId,
            track: msg.track,
            linkedinUrl: profile.linkedinUrl,
            name: profile.name,
            status: "drafted",
            structureVariant:
              personaId === "founder"
                ? (msg.founderVariant ?? settings.founderVariant)
                : (msg.personalStructure ?? settings.personalStructure),
            founderVariant: msg.founderVariant,
            personalStructure: msg.personalStructure,
            drafts,
            sentMessageIds: [],
            notes: msg.notes ?? "",
            profile,
            segment,
            timestamps: { generated: new Date().toISOString() },
          };

          const outreach = await getOutreach();
          outreach.unshift(record);
          await saveOutreach(outreach);
          sendResponse({ ok: true, data: { drafts, record, validationWarnings: validation.warnings } });
          break;
        }

        case "GET_OUTREACH":
          sendResponse({ ok: true, data: await getOutreach() });
          break;

        case "MARK_SENT": {
          const outreach = await getOutreach();
          const idx = outreach.findIndex((o) => o.id === msg.outreachId);
          if (idx < 0) {
            sendResponse({ ok: false, error: "Outreach not found" });
            break;
          }
          const record = outreach[idx];
          const touchType = msg.touchType;
          const sentText = sanitizeSentText(msg.sentText as string);
          if (!sentText) {
            sendResponse({ ok: false, error: "Cannot mark empty message as sent" });
            break;
          }
          const generatedText = record.drafts[
            touchType === "initial" ? "initial" : touchType === "follow_up_1" ? "followUp1" : "followUp2"
          ];

          const features = extractMessageFeatures(sentText, {
            persona: record.persona,
            touchType,
            structureVariant: record.structureVariant ?? "",
            recipientSegment: record.segment,
            firstName: record.profile.firstName,
            shortName: record.profile.shortName,
            sentAt: new Date(),
          });

          const event = await logEvent({
            type: "message_sent",
            outreachId: record.id,
            linkedinUrl: record.linkedinUrl,
            generatedText,
            sentText,
            editDistance: levenshtein(generatedText, sentText),
            features,
            recipientSegment: record.segment,
            frameworkVersion: settings.frameworkVersion,
            variationKey: `${record.persona}_${touchType}_${record.structureVariant}`,
            timestamp: new Date().toISOString(),
          });

          record.sentMessageIds.push(event.id);
          if (touchType === "initial") {
            record.status = "initial_sent";
            record.timestamps.initialSent = new Date().toISOString();
            const days = settings.personas[record.persona].followUpCadenceDays[0];
            record.nextFollowUpDue = new Date(Date.now() + days * 86400000).toISOString();
          } else if (touchType === "follow_up_1") {
            record.status = "follow_up_1_sent";
            record.timestamps.followUp1Sent = new Date().toISOString();
            const days = settings.personas[record.persona].followUpCadenceDays[1];
            record.nextFollowUpDue = new Date(Date.now() + days * 86400000).toISOString();
          } else if (touchType === "follow_up_2") {
            record.status = "follow_up_2_sent";
            record.timestamps.followUp2Sent = new Date().toISOString();
            record.nextFollowUpDue = undefined;
          }

          outreach[idx] = record;
          await saveOutreach(outreach);
          sendResponse({ ok: true, data: record });
          break;
        }

        case "MARK_REPLY": {
          const outreach = await getOutreach();
          const idx = outreach.findIndex((o) => o.id === msg.outreachId);
          if (idx < 0) {
            sendResponse({ ok: false, error: "Not found" });
            break;
          }
          const record = outreach[idx];
          record.status = msg.positive ? "positive_reply" : "replied";
          if (msg.positive) record.timestamps.positiveReplyAt = new Date().toISOString();
          else record.timestamps.repliedAt = new Date().toISOString();
          record.nextFollowUpDue = undefined;

          const lastEvent = (await getEvents()).filter((e) => e.outreachId === record.id && e.type === "message_sent").pop();
          if (lastEvent) {
            await logEvent({
              type: msg.positive ? "positive_reply" : "reply",
              outreachId: record.id,
              linkedinUrl: record.linkedinUrl,
              generatedText: lastEvent.generatedText,
              sentText: lastEvent.sentText,
              editDistance: 0,
              features: { ...lastEvent.features, gotReply: true, gotPositiveReply: !!msg.positive },
              recipientSegment: record.segment,
              frameworkVersion: settings.frameworkVersion,
              variationKey: lastEvent.variationKey,
              timestamp: new Date().toISOString(),
            });
          }

          outreach[idx] = record;
          await saveOutreach(outreach);
          sendResponse({ ok: true, data: record });
          break;
        }

        case "GET_METRICS": {
          const events = await getEvents();
          const metrics = aggregateMetrics(events);
          sendResponse({ ok: true, data: { events, metrics } });
          break;
        }

        case "EXPORT_CSV": {
          const events = await getEvents();
          const header = "id,type,persona,touchType,openerType,ctaType,replyRate,timestamp,sentText\n";
          const rows = events
            .map(
              (e) =>
                `${e.id},${e.type},${e.features.persona},${e.features.touchType},${e.features.openerType},${e.features.ctaType},,${e.timestamp},"${e.sentText.replace(/"/g, '""')}"`,
            )
            .join("\n");
          sendResponse({ ok: true, data: header + rows });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
