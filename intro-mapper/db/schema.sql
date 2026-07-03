-- Warm-intro graph schema. One org = one tenant; every row is org-scoped so no
-- data crosses company boundaries. Interaction bodies are never stored, only
-- metadata pointers (see edges.evidence).

CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  -- The person node representing this teammate in the graph.
  person_id   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

-- Consent + connector opt-in state, recorded per user.
CREATE TABLE IF NOT EXISTS consents (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_with_team BOOLEAN NOT NULL DEFAULT false,
  intro_maker_opt_in BOOLEAN NOT NULL DEFAULT false,
  retention_days INTEGER NOT NULL DEFAULT 365,
  consented_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS persons (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  company       TEXT,
  title         TEXT,
  location      TEXT,
  resolution    TEXT NOT NULL,
  resolution_confidence REAL NOT NULL DEFAULT 0,
  accounts      JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS persons_org_idx ON persons(org_id);
CREATE INDEX IF NOT EXISTS persons_norm_name_idx ON persons(org_id, normalized_name);

CREATE TABLE IF NOT EXISTS edges (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  from_person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  to_person_id  TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  source        TEXT NOT NULL,
  confidence    REAL NOT NULL DEFAULT 0,
  evidence      JSONB NOT NULL DEFAULT '[]',
  -- The teammate (user_id) whose data surfaced this edge; used for cascade delete on opt-out.
  contributed_by TEXT NOT NULL,
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS edges_org_idx ON edges(org_id);
CREATE INDEX IF NOT EXISTS edges_to_idx ON edges(org_id, to_person_id);
CREATE INDEX IF NOT EXISTS edges_from_idx ON edges(org_id, from_person_id);
CREATE INDEX IF NOT EXISTS edges_contributor_idx ON edges(org_id, contributed_by);

-- Outcome tracking for intro requests -> feeds the responsiveness score.
CREATE TABLE IF NOT EXISTS intro_requests (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  target_person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  connector_person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  requested_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',
  draft         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intro_requests_org_idx ON intro_requests(org_id);
