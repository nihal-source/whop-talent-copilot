import type { Edge, Person } from "../shared";
import type { Consent, IntroRequest, Org, User } from "../types";

/**
 * Storage abstraction. Two implementations exist: an in-memory store (default,
 * for local dev without a database) and a Postgres store (production). Every
 * method is org-scoped to enforce tenant isolation.
 */
export interface Store {
  ensureOrg(name: string): Promise<Org>;
  getOrg(id: string): Promise<Org | null>;

  upsertUser(orgId: string, email: string, name: string): Promise<User>;
  getUser(orgId: string, userId: string): Promise<User | null>;
  listUsers(orgId: string): Promise<User[]>;
  setUserPerson(orgId: string, userId: string, personId: string): Promise<void>;

  getConsent(orgId: string, userId: string): Promise<Consent | null>;
  setConsent(consent: Consent): Promise<void>;
  listConsents(orgId: string): Promise<Consent[]>;

  upsertPerson(orgId: string, person: Person): Promise<void>;
  getPerson(orgId: string, personId: string): Promise<Person | null>;
  listPersons(orgId: string): Promise<Person[]>;
  findPersonByHandle(orgId: string, platform: string, handle: string): Promise<Person | null>;

  addEdges(orgId: string, edges: Edge[]): Promise<void>;
  listEdges(orgId: string): Promise<Edge[]>;
  removeEdgesByContributor(orgId: string, contributedBy: string): Promise<number>;

  createIntroRequest(req: IntroRequest): Promise<void>;
  listIntroRequests(orgId: string): Promise<IntroRequest[]>;
  updateIntroRequestStatus(
    orgId: string,
    id: string,
    status: IntroRequest["status"],
  ): Promise<void>;
}
