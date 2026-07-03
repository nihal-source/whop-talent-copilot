import type { Edge, Person } from "./types";
import { mergeAccounts, normalizeName, resolveIdentity } from "./identity";
import type { ImportedContact } from "./parsers/types";

/**
 * In-memory graph that ingests parsed contacts into Person nodes + Edges. Node
 * identity is resolved by shared platform handle; name collisions are recorded
 * as ambiguous rather than silently merged. Storage-agnostic so it can back an
 * in-extension preview or seed the web app's database.
 */
export class IntroGraph {
  private persons = new Map<string, Person>();
  private edges = new Map<string, Edge>();
  private handleIndex = new Map<string, string>(); // "platform:handle" -> personId
  private seq = 0;

  /** Ambiguous merges (same name + company, no shared handle) for the UI to resolve. */
  readonly ambiguities: Array<{ existingId: string; candidateName: string }> = [];

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private indexKeys(person: Pick<Person, "accounts">): string[] {
    return person.accounts.filter((a) => a.handle).map((a) => `${a.platform}:${a.handle}`);
  }

  /** Find an existing person by any shared handle. */
  private findByHandle(person: Pick<Person, "accounts">): Person | undefined {
    for (const key of this.indexKeys(person)) {
      const id = this.handleIndex.get(key);
      if (id) return this.persons.get(id);
    }
    return undefined;
  }

  /** Upsert a person, merging accounts onto an existing node when handles match. */
  upsertPerson(input: Omit<Person, "id" | "normalizedName"> & { id?: string }): Person {
    const normalizedName = normalizeName(input.name);
    const candidate = { normalizedName, accounts: input.accounts, company: input.company };
    const existing = this.findByHandle(input);

    if (existing) {
      existing.accounts = mergeAccounts(existing.accounts, input.accounts);
      existing.company = existing.company || input.company;
      existing.title = existing.title || input.title;
      existing.location = existing.location || input.location;
      // Prefer the higher-confidence resolution source.
      if (input.resolutionConfidence > existing.resolutionConfidence) {
        existing.resolution = input.resolution;
        existing.resolutionConfidence = input.resolutionConfidence;
      }
      for (const key of this.indexKeys(existing)) this.handleIndex.set(key, existing.id);
      return existing;
    }

    // No handle match. Check for name collisions to flag ambiguity.
    for (const p of this.persons.values()) {
      if (resolveIdentity(p, candidate) === "ambiguous") {
        this.ambiguities.push({ existingId: p.id, candidateName: input.name });
        break;
      }
    }

    const person: Person = {
      id: input.id ?? this.nextId("person"),
      name: input.name,
      normalizedName,
      accounts: input.accounts,
      company: input.company,
      title: input.title,
      location: input.location,
      resolution: input.resolution,
      resolutionConfidence: input.resolutionConfidence,
    };
    this.persons.set(person.id, person);
    for (const key of this.indexKeys(person)) this.handleIndex.set(key, person.id);
    return person;
  }

  /**
   * Ingest one teammate's parsed export. `ownerPersonId` is the teammate's own
   * node; every contact becomes an edge owner -> contact tagged with provenance.
   * Duplicate edges (same pair/type) keep the highest-confidence instance.
   */
  ingestContacts(
    ownerPersonId: string,
    contributedBy: string,
    contacts: ImportedContact[],
    observedAt = new Date().toISOString(),
  ): { added: number; merged: number } {
    let added = 0;
    let merged = 0;
    for (const c of contacts) {
      const person = this.upsertPerson({
        name: c.name,
        accounts: c.accounts,
        company: c.company,
        title: c.title,
        resolution: "export",
        resolutionConfidence: c.accounts.length ? 0.9 : 0.4,
      });
      const edgeKey = `${ownerPersonId}->${person.id}:${c.edgeType}`;
      const existing = this.edges.get(edgeKey);
      if (existing) {
        merged++;
        if (c.confidence > existing.confidence) existing.confidence = c.confidence;
        existing.evidence.push(...c.evidence);
        continue;
      }
      this.edges.set(edgeKey, {
        id: this.nextId("edge"),
        fromPersonId: ownerPersonId,
        toPersonId: person.id,
        type: c.edgeType,
        source: c.source,
        confidence: c.confidence,
        evidence: [...c.evidence],
        contributedBy,
        observedAt,
      });
      added++;
    }
    return { added, merged };
  }

  addEdge(edge: Omit<Edge, "id">): Edge {
    const built: Edge = { ...edge, id: this.nextId("edge") };
    this.edges.set(`${edge.fromPersonId}->${edge.toPersonId}:${edge.type}:${built.id}`, built);
    return built;
  }

  /** Load a persisted person preserving its id (no ambiguity checks). */
  loadPerson(person: Person): void {
    this.persons.set(person.id, person);
    for (const key of this.indexKeys(person)) this.handleIndex.set(key, person.id);
  }

  /** Load a persisted edge preserving its id. */
  loadEdge(edge: Edge): void {
    this.edges.set(`${edge.fromPersonId}->${edge.toPersonId}:${edge.type}`, edge);
  }

  /** Remove a teammate's contributed edges (opt-out / account deletion). */
  removeContributor(contributedBy: string): number {
    let removed = 0;
    for (const [key, edge] of this.edges) {
      if (edge.contributedBy === contributedBy) {
        this.edges.delete(key);
        removed++;
      }
    }
    return removed;
  }

  getPerson(id: string): Person | undefined {
    return this.persons.get(id);
  }

  findPersonByHandle(platform: string, handle: string): Person | undefined {
    const id = this.handleIndex.get(`${platform}:${handle}`);
    return id ? this.persons.get(id) : undefined;
  }

  allPersons(): Person[] {
    return [...this.persons.values()];
  }

  allEdges(): Edge[] {
    return [...this.edges.values()];
  }

  /** Outgoing + incoming edges touching a person. */
  edgesFor(personId: string): Edge[] {
    return this.allEdges().filter(
      (e) => e.fromPersonId === personId || e.toPersonId === personId,
    );
  }
}
