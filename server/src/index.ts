import cors from "cors";
import express from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { OutreachEvent } from "@whop-copilot/shared";

const PORT = 3456;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const EVENTS_FILE = join(DATA_DIR, "events.json");

function loadEvents(): OutreachEvent[] {
  if (!existsSync(EVENTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(EVENTS_FILE, "utf-8")) as OutreachEvent[];
  } catch {
    return [];
  }
}

function saveEvents(events: OutreachEvent[]) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, events: loadEvents().length });
});

app.get("/api/events", (_req, res) => {
  res.json(loadEvents());
});

app.post("/api/events", (req, res) => {
  const event = req.body as OutreachEvent;
  if (!event?.id || !event?.type) {
    res.status(400).json({ error: "Invalid event" });
    return;
  }
  const events = loadEvents();
  if (!events.find((e) => e.id === event.id)) {
    events.push(event);
    saveEvents(events);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Whop Talent Co-pilot event server on http://localhost:${PORT}`);
});
