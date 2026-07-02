# Whop Talent Co-pilot

A Chrome extension (MV3, built with [Plasmo](https://www.plasmo.com/)) for recruiting: talent-bar
sourcing, personalized outreach drafting, and conversion analytics with adaptive learning.

## Workspaces

| Path | What it is |
|---|---|
| `shared/` | Core logic — talent-bar scoring, recipient segmentation, prompt building, draft validation/hallucination guards, and the pluggable profile-enrichment layer. |
| `extension/` | The Plasmo extension — side panel, options page, background service worker, and LinkedIn content scripts. |
| `server/` | Optional Express server that persists outreach events to a local JSON file for analytics. |

## Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/) (message generation)
- *(Optional)* an [Apify](https://apify.com) API token for real-time profile enrichment

## Setup

```bash
npm install
npm run build -w extension
```

Then load the extension in Chrome:

1. Go to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `extension/build/chrome-mv3-prod`.
3. Open the side panel and go to **Options → API** to add your keys.

## Profile data: two ways

- **DOM scrape (default, free):** reads the LinkedIn profile tab you're viewing.
- **API enrichment (optional):** set a provider in **Options → API**. With Apify configured you
  can pull a full profile from just a URL and bulk-enrich your whole queue without opening each
  profile. The pluggable provider makes adding other sources (ScrapIn, Bright Data, People Data
  Labs, account-based APIs) a small, isolated change.

## Messaging

All generated messages are drafts only — nothing is auto-sent. Drafts are constrained to 50–70
words and validated against the allowed facts extracted from the profile/notes to prevent
hallucinated claims.

## Optional analytics server

```bash
npm run dev:server   # http://localhost:3456
```

The extension works fully without it; when running, outreach events are also persisted server-side.
