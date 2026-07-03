import { Pool } from "pg";
import type { Edge, Person } from "../shared";
import type { Consent, IntroRequest, Org, User } from "../types";
import type { Store } from "./interface";

/** Postgres-backed store. Enabled when DATABASE_URL is set. See db/schema.sql. */
function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function rowToPerson(r: any): Person {
  return {
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    accounts: r.accounts ?? [],
    company: r.company ?? undefined,
    title: r.title ?? undefined,
    location: r.location ?? undefined,
    resolution: r.resolution,
    resolutionConfidence: r.resolution_confidence,
  };
}

function rowToEdge(r: any): Edge {
  return {
    id: r.id,
    fromPersonId: r.from_person_id,
    toPersonId: r.to_person_id,
    type: r.type,
    source: r.source,
    confidence: r.confidence,
    evidence: r.evidence ?? [],
    contributedBy: r.contributed_by,
    observedAt:
      r.observed_at instanceof Date ? r.observed_at.toISOString() : String(r.observed_at),
  };
}

export class PostgresStore implements Store {
  constructor(private pool: Pool) {}

  async ensureOrg(name: string): Promise<Org> {
    const found = await this.pool.query("SELECT * FROM orgs WHERE name = $1", [name]);
    if (found.rows[0]) {
      const o = found.rows[0];
      return { id: o.id, name: o.name, createdAt: o.created_at.toISOString() };
    }
    const id = rid("org");
    const res = await this.pool.query(
      "INSERT INTO orgs (id, name) VALUES ($1, $2) RETURNING *",
      [id, name],
    );
    const o = res.rows[0];
    return { id: o.id, name: o.name, createdAt: o.created_at.toISOString() };
  }

  async getOrg(id: string): Promise<Org | null> {
    const res = await this.pool.query("SELECT * FROM orgs WHERE id = $1", [id]);
    const o = res.rows[0];
    return o ? { id: o.id, name: o.name, createdAt: o.created_at.toISOString() } : null;
  }

  async upsertUser(orgId: string, email: string, name: string): Promise<User> {
    const found = await this.pool.query(
      "SELECT * FROM users WHERE org_id = $1 AND email = $2",
      [orgId, email],
    );
    if (found.rows[0]) return this.rowToUser(found.rows[0]);
    const id = rid("user");
    const res = await this.pool.query(
      "INSERT INTO users (id, org_id, email, name) VALUES ($1, $2, $3, $4) RETURNING *",
      [id, orgId, email, name],
    );
    return this.rowToUser(res.rows[0]);
  }

  private rowToUser(r: any): User {
    return {
      id: r.id,
      orgId: r.org_id,
      email: r.email,
      name: r.name,
      personId: r.person_id ?? undefined,
      createdAt: r.created_at.toISOString(),
    };
  }

  async getUser(orgId: string, userId: string): Promise<User | null> {
    const res = await this.pool.query(
      "SELECT * FROM users WHERE org_id = $1 AND id = $2",
      [orgId, userId],
    );
    return res.rows[0] ? this.rowToUser(res.rows[0]) : null;
  }

  async listUsers(orgId: string): Promise<User[]> {
    const res = await this.pool.query("SELECT * FROM users WHERE org_id = $1", [orgId]);
    return res.rows.map((r) => this.rowToUser(r));
  }

  async setUserPerson(orgId: string, userId: string, personId: string): Promise<void> {
    await this.pool.query(
      "UPDATE users SET person_id = $3 WHERE org_id = $1 AND id = $2",
      [orgId, userId, personId],
    );
  }

  async getConsent(orgId: string, userId: string): Promise<Consent | null> {
    const res = await this.pool.query(
      "SELECT * FROM consents WHERE org_id = $1 AND user_id = $2",
      [orgId, userId],
    );
    const c = res.rows[0];
    if (!c) return null;
    return {
      orgId: c.org_id,
      userId: c.user_id,
      shareWithTeam: c.share_with_team,
      introMakerOptIn: c.intro_maker_opt_in,
      retentionDays: c.retention_days,
      consentedAt: c.consented_at.toISOString(),
    };
  }

  async setConsent(consent: Consent): Promise<void> {
    await this.pool.query(
      `INSERT INTO consents (id, org_id, user_id, share_with_team, intro_maker_opt_in, retention_days, consented_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (org_id, user_id) DO UPDATE SET
         share_with_team = EXCLUDED.share_with_team,
         intro_maker_opt_in = EXCLUDED.intro_maker_opt_in,
         retention_days = EXCLUDED.retention_days,
         consented_at = now()`,
      [
        rid("consent"),
        consent.orgId,
        consent.userId,
        consent.shareWithTeam,
        consent.introMakerOptIn,
        consent.retentionDays,
      ],
    );
  }

  async listConsents(orgId: string): Promise<Consent[]> {
    const res = await this.pool.query("SELECT * FROM consents WHERE org_id = $1", [orgId]);
    return res.rows.map((c) => ({
      orgId: c.org_id,
      userId: c.user_id,
      shareWithTeam: c.share_with_team,
      introMakerOptIn: c.intro_maker_opt_in,
      retentionDays: c.retention_days,
      consentedAt: c.consented_at.toISOString(),
    }));
  }

  async upsertPerson(orgId: string, person: Person): Promise<void> {
    await this.pool.query(
      `INSERT INTO persons (id, org_id, name, normalized_name, company, title, location, resolution, resolution_confidence, accounts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         normalized_name = EXCLUDED.normalized_name,
         company = EXCLUDED.company,
         title = EXCLUDED.title,
         location = EXCLUDED.location,
         resolution = EXCLUDED.resolution,
         resolution_confidence = EXCLUDED.resolution_confidence,
         accounts = EXCLUDED.accounts`,
      [
        person.id,
        orgId,
        person.name,
        person.normalizedName,
        person.company ?? null,
        person.title ?? null,
        person.location ?? null,
        person.resolution,
        person.resolutionConfidence,
        JSON.stringify(person.accounts),
      ],
    );
  }

  async getPerson(orgId: string, personId: string): Promise<Person | null> {
    const res = await this.pool.query(
      "SELECT * FROM persons WHERE org_id = $1 AND id = $2",
      [orgId, personId],
    );
    return res.rows[0] ? rowToPerson(res.rows[0]) : null;
  }

  async listPersons(orgId: string): Promise<Person[]> {
    const res = await this.pool.query("SELECT * FROM persons WHERE org_id = $1", [orgId]);
    return res.rows.map(rowToPerson);
  }

  async findPersonByHandle(
    orgId: string,
    platform: string,
    handle: string,
  ): Promise<Person | null> {
    const res = await this.pool.query(
      `SELECT * FROM persons WHERE org_id = $1
       AND accounts @> $2::jsonb LIMIT 1`,
      [orgId, JSON.stringify([{ platform, handle }])],
    );
    return res.rows[0] ? rowToPerson(res.rows[0]) : null;
  }

  async addEdges(orgId: string, edges: Edge[]): Promise<void> {
    if (edges.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const e of edges) {
        await client.query(
          `INSERT INTO edges (id, org_id, from_person_id, to_person_id, type, source, confidence, evidence, contributed_by, observed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            e.id,
            orgId,
            e.fromPersonId,
            e.toPersonId,
            e.type,
            e.source,
            e.confidence,
            JSON.stringify(e.evidence),
            e.contributedBy,
            e.observedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listEdges(orgId: string): Promise<Edge[]> {
    const res = await this.pool.query("SELECT * FROM edges WHERE org_id = $1", [orgId]);
    return res.rows.map(rowToEdge);
  }

  async removeEdgesByContributor(orgId: string, contributedBy: string): Promise<number> {
    const res = await this.pool.query(
      "DELETE FROM edges WHERE org_id = $1 AND contributed_by = $2",
      [orgId, contributedBy],
    );
    return res.rowCount ?? 0;
  }

  async createIntroRequest(req: IntroRequest): Promise<void> {
    await this.pool.query(
      `INSERT INTO intro_requests (id, org_id, target_person_id, connector_person_id, requested_by, status, draft)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.id,
        req.orgId,
        req.targetPersonId,
        req.connectorPersonId,
        req.requestedBy,
        req.status,
        req.draft ?? null,
      ],
    );
  }

  async listIntroRequests(orgId: string): Promise<IntroRequest[]> {
    const res = await this.pool.query(
      "SELECT * FROM intro_requests WHERE org_id = $1 ORDER BY created_at DESC",
      [orgId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      targetPersonId: r.target_person_id,
      connectorPersonId: r.connector_person_id,
      requestedBy: r.requested_by,
      status: r.status,
      draft: r.draft ?? undefined,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async updateIntroRequestStatus(
    orgId: string,
    id: string,
    status: IntroRequest["status"],
  ): Promise<void> {
    await this.pool.query(
      "UPDATE intro_requests SET status = $3, updated_at = now() WHERE org_id = $1 AND id = $2",
      [orgId, id, status],
    );
  }
}
