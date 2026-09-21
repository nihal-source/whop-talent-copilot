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
- *(Optional)* a [Crustdata](https://crustdata.com), [Apify](https://apify.com), or
  [People Data Labs](https://peopledatalabs.com) key for profile enrichment

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
- **API enrichment (optional):** set a provider in **Options → API**. With a provider configured
  you can pull a full profile from just a URL and bulk-enrich your whole queue without opening
  each profile.

| Provider | What it is | Where the key goes |
|---|---|---|
| `crustdata` | Crustdata person enrich — profile URL → cached profile | Options → API → *Crustdata API Key* |
| `apify` | No-cookie LinkedIn Profile Enricher actor | Options → API → *Apify API Token* |
| `pdl` | People Data Labs identity resolution | Options → API → *People Data Labs API Key* |

### Crustdata setup

1. Get a key from your [Crustdata](https://crustdata.com) dashboard.
2. In **Options → API**, pick **Crustdata** as the enrichment provider and paste the key.
3. Open a LinkedIn profile and hit **Enrich via API** in the side panel, or **Enrich queue via
   API** on the Queue tab.

The extension calls `GET https://api.crustdata.com/screener/person/enrich` with the profile URL
and an `Authorization: Token …` header, then normalizes the response into the same `ProfileData`
shape the scraper produces (the nested `/person/enrich` match envelope is handled too). Keys live
in `chrome.storage.local` only — nothing is written to the repo, and no key is ever committed.

## Messaging

All generated messages are drafts only — nothing is auto-sent. Every draft is validated against
the allowed facts extracted from the profile, your notes, and any verified external context, so a
message that claims a quota number, a #1 ranking, a mutual connection, or a funding round the
inputs don't support is flagged before you send it.

### The two initial-message shapes

An initial Personal message may only take one of two shapes, and both are drafted on every
generation so you can pick the one that fits:

| | Shape | Recipe | Words |
|---|---|---|---|
| **Shape 1** | observation → question | one concrete, true observation about them, then one real question about it. No Whop pitch, no comp, no proof points, no ask for a call. | 18–45 |
| **Shape 2** | observation → value prop → question | the same observation, then **one** short line on why Whop might be worth a look (at most one proof point), then the question. | 30–60 |

The toggle on the **Sourcing** tab (and the default in **Options → Style Studio**) decides which
shape lands in the Initial slot; the other is drafted alongside it as *Alternate* and can be
swapped in. Follow-ups run 25–55 words.

Shape 1 is deliberately allowed to run shorter than the old 50–70 word floor. Padding an
observation-and-a-question out to 50 words is what produced the long "higher ceiling… 75%
ex-founders… unicorn'd with only 60 people" pitch, so a tight 27-word Shape 1 is a pass, not a
warning — the validator ranges each shape separately and flags filler-length drafts instead of
short ones.

## Optional analytics server

```bash
npm run dev:server   # http://localhost:3456
```

The extension works fully without it; when running, outreach events are also persisted server-side.
