import { promises as fs } from "node:fs";
import path from "node:path";
import type { Edge, Person } from "../shared";
import type { Consent, IntroRequest, Org, User } from "../types";
import type { Store } from "./interface";

/**
 * In-memory store with optional JSON-file durability so local dev survives
 * server restarts. Not for production (no concurrency guarantees) — set
 * DATABASE_URL to switch to Postgres.
 */
interface Snapshot {
  orgs: Org[];
  users: User[];
  consents: Consent[];
  persons: Array<Person & { orgId: string }>;
  edges: Array<Edge & { orgId: string }>;
  introRequests: IntroRequest[];
}

function rid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

const DATA_FILE = path.join(process.cwd(), "data", "store.json");

export class MemoryStore implements Store {
  private data: Snapshot = {
    orgs: [],
    users: [],
    consents: [],
    persons: [],
    edges: [],
    introRequests: [],
  };
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      this.data = JSON.parse(raw) as Snapshot;
    } catch {
      // No snapshot yet — start empty.
    }
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(this.data, null, 2));
    } catch {
      // Persistence is best-effort in dev.
    }
  }

  async ensureOrg(name: string): Promise<Org> {
    await this.load();
    const existing = this.data.orgs.find((o) => o.name === name);
    if (existing) return existing;
    const org: Org = { id: rid("org"), name, createdAt: new Date().toISOString() };
    this.data.orgs.push(org);
    await this.persist();
    return org;
  }

  async getOrg(id: string): Promise<Org | null> {
    await this.load();
    return this.data.orgs.find((o) => o.id === id) ?? null;
  }

  async upsertUser(orgId: string, email: string, name: string): Promise<User> {
    await this.load();
    const found = this.data.users.find((u) => u.orgId === orgId && u.email === email);
    if (found) return found;
    const user: User = { id: rid("user"), orgId, email, name, createdAt: new Date().toISOString() };
    this.data.users.push(user);
    await this.persist();
    return user;
  }

  async getUser(orgId: string, userId: string): Promise<User | null> {
    await this.load();
    return this.data.users.find((u) => u.orgId === orgId && u.id === userId) ?? null;
  }

  async listUsers(orgId: string): Promise<User[]> {
    await this.load();
    return this.data.users.filter((u) => u.orgId === orgId);
  }

  async setUserPerson(orgId: string, userId: string, personId: string): Promise<void> {
    await this.load();
    const user = this.data.users.find((u) => u.orgId === orgId && u.id === userId);
    if (user) {
      user.personId = personId;
      await this.persist();
    }
  }

  async getConsent(orgId: string, userId: string): Promise<Consent | null> {
    await this.load();
    return this.data.consents.find((c) => c.orgId === orgId && c.userId === userId) ?? null;
  }

  async setConsent(consent: Consent): Promise<void> {
    await this.load();
    const idx = this.data.consents.findIndex(
      (c) => c.orgId === consent.orgId && c.userId === consent.userId,
    );
    if (idx >= 0) this.data.consents[idx] = consent;
    else this.data.consents.push(consent);
    await this.persist();
  }

  async listConsents(orgId: string): Promise<Consent[]> {
    await this.load();
    return this.data.consents.filter((c) => c.orgId === orgId);
  }

  async upsertPerson(orgId: string, person: Person): Promise<void> {
    await this.load();
    const idx = this.data.persons.findIndex((p) => p.orgId === orgId && p.id === person.id);
    const row = { ...person, orgId };
    if (idx >= 0) this.data.persons[idx] = row;
    else this.data.persons.push(row);
    await this.persist();
  }

  async getPerson(orgId: string, personId: string): Promise<Person | null> {
    await this.load();
    return this.data.persons.find((p) => p.orgId === orgId && p.id === personId) ?? null;
  }

  async listPersons(orgId: string): Promise<Person[]> {
    await this.load();
    return this.data.persons.filter((p) => p.orgId === orgId);
  }

  async findPersonByHandle(
    orgId: string,
    platform: string,
    handle: string,
  ): Promise<Person | null> {
    await this.load();
    return (
      this.data.persons.find(
        (p) =>
          p.orgId === orgId &&
          p.accounts.some((a) => a.platform === platform && a.handle === handle),
      ) ?? null
    );
  }

  async addEdges(orgId: string, edges: Edge[]): Promise<void> {
    await this.load();
    for (const e of edges) this.data.edges.push({ ...e, orgId });
    await this.persist();
  }

  async listEdges(orgId: string): Promise<Edge[]> {
    await this.load();
    return this.data.edges.filter((e) => e.orgId === orgId);
  }

  async removeEdgesByContributor(orgId: string, contributedBy: string): Promise<number> {
    await this.load();
    const before = this.data.edges.length;
    this.data.edges = this.data.edges.filter(
      (e) => !(e.orgId === orgId && e.contributedBy === contributedBy),
    );
    await this.persist();
    return before - this.data.edges.length;
  }

  async createIntroRequest(req: IntroRequest): Promise<void> {
    await this.load();
    this.data.introRequests.push(req);
    await this.persist();
  }

  async listIntroRequests(orgId: string): Promise<IntroRequest[]> {
    await this.load();
    return this.data.introRequests.filter((r) => r.orgId === orgId);
  }

  async updateIntroRequestStatus(
    orgId: string,
    id: string,
    status: IntroRequest["status"],
  ): Promise<void> {
    await this.load();
    const req = this.data.introRequests.find((r) => r.orgId === orgId && r.id === id);
    if (req) {
      req.status = status;
      req.updatedAt = new Date().toISOString();
      await this.persist();
    }
  }
}
