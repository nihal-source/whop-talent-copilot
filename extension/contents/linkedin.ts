import type { PlasmoCSConfig } from "plasmo";

export const config: PlasmoCSConfig = {
  matches: ["https://www.linkedin.com/in/*", "https://www.linkedin.com/messaging/*"],
  run_at: "document_idle",
};

import {
  shortNameFromFirst,
  type ExperienceEntry,
  type EducationEntry,
  type ProfileData,
} from "@whop-copilot/shared";

function text(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

function queryOne(selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function queryAll(selectors: string[]): Element[] {
  for (const sel of selectors) {
    const els = [...document.querySelectorAll(sel)];
    if (els.length) return els;
  }
  return [];
}

function parseName(raw: string): { name: string; firstName: string; shortName: string } {
  const name = raw.split("|")[0].trim();
  const parts = name.split(/\s+/);
  const firstName = parts[0] ?? name;
  const shortName = shortNameFromFirst(firstName);
  return { name: name || "Unknown", firstName, shortName };
}

function scrapeExperience(): ExperienceEntry[] {
  const items: ExperienceEntry[] = [];
  const sections = queryAll([
    "#experience ~ .pvs-list__outer-container li",
    "section[data-view-name='profile-card'] #experience ~ div li",
    ".pvs-list__paged-list-item",
  ]);

  for (const li of sections.slice(0, 8)) {
    const spans = li.querySelectorAll("span[aria-hidden='true']");
    const texts = [...spans].map((s) => text(s)).filter(Boolean);
    if (texts.length < 2) continue;
    const title = texts[0];
    const company = texts[1];
    if (!title || !company) continue;
    const dateEl = li.querySelector(".pvs-entity__caption-wrapper, .t-14.t-normal.t-black--light");
    const dateStr = text(dateEl);
    const isCurrent = /present/i.test(dateStr);
    items.push({
      company: company.split("·")[0].trim(),
      title,
      startDate: dateStr,
      isCurrent,
    });
  }
  return items;
}

function scrapeEducation(): EducationEntry[] {
  const items: EducationEntry[] = [];
  const sections = queryAll([
    "#education ~ .pvs-list__outer-container li",
    "section[data-view-name='profile-card'] #education ~ div li",
  ]);

  for (const li of sections.slice(0, 5)) {
    const spans = li.querySelectorAll("span[aria-hidden='true']");
    const texts = [...spans].map((s) => text(s)).filter(Boolean);
    if (!texts.length) continue;
    const school = texts[0];
    const degree = texts[1];
    const dateEl = li.querySelector(".pvs-entity__caption-wrapper");
    const dateStr = text(dateEl);
    const years = dateStr.match(/(\d{4})/g)?.map(Number) ?? [];
    items.push({
      school,
      degree,
      endYear: years.length ? Math.max(...years) : undefined,
      startYear: years.length ? Math.min(...years) : undefined,
    });
  }
  return items;
}

export function scrapeProfileFromDom(): ProfileData {
  const url = window.location.href.split("?")[0];
  const nameEl = queryOne([
    "h1.text-heading-xlarge",
    "h1.inline.t-24",
    ".pv-text-details__left-panel h1",
    "main h1",
  ]);
  const headlineEl = queryOne([
    ".text-body-medium.break-words",
    ".pv-text-details__left-panel .text-body-medium",
    "div.ph5 .text-body-medium",
  ]);
  const aboutEl = queryOne([
    "#about ~ .display-flex .visually-hidden + span",
    "section[data-view-name='profile-card'] #about ~ div span[aria-hidden='true']",
    "#about + div span",
  ]);
  const locationEl = queryOne([
    ".text-body-small.inline.t-black--light.break-words",
    ".pv-text-details__left-panel .text-body-small",
  ]);

  const rawName = text(nameEl) || "Unknown";
  const { name, firstName, shortName } = parseName(rawName);
  const experience = scrapeExperience();
  const education = scrapeEducation();

  const hasName = name !== "Unknown";
  const hasExp = experience.length > 0;
  const scrapeHealth = hasName && (hasExp || text(headlineEl)) ? (hasExp ? "full" : "partial") : hasName ? "partial" : "failed";

  return {
    linkedinUrl: url,
    name,
    firstName,
    shortName,
    headline: text(headlineEl),
    currentCompany: experience.find((e) => e.isCurrent)?.company ?? experience[0]?.company ?? "",
    currentTitle: experience.find((e) => e.isCurrent)?.title ?? experience[0]?.title ?? "",
    location: text(locationEl),
    about: text(aboutEl),
    education,
    experience,
    scrapeHealth,
  };
}

function prefillCompose(message: string): boolean {
  if (!message.trim()) return false;
  const selectors = [
    "div.msg-form__contenteditable[contenteditable='true']",
    "div[role='textbox'][contenteditable='true']",
    ".compose-form__message-field div[contenteditable='true']",
    "textarea[name='message']",
  ];

  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      el.value = message;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    el.textContent = message;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: message }));
    document.execCommand?.("insertText", false, message);
    return true;
  }
  return false;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_PROFILE") {
    try {
      sendResponse({ ok: true, data: scrapeProfileFromDom() });
    } catch {
      sendResponse({ ok: false, error: "Scrape failed" });
    }
    return true;
  }
  if (msg.type === "PREFILL_COMPOSE") {
    const ok = prefillCompose(msg.text);
    sendResponse({ ok, error: ok ? undefined : "Compose box not found" });
    return true;
  }
  return false;
});

// Notify side panel on navigation
let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (location.pathname.includes("/in/")) {
      chrome.runtime.sendMessage({ type: "PROFILE_NAVIGATED", url: lastUrl }).catch(() => {});
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
