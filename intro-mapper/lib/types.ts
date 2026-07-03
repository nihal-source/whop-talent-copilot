import type { Edge, Person } from "./shared";

export interface Org {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  /** Person node representing this teammate in the graph. */
  personId?: string;
  createdAt: string;
}

export interface Consent {
  orgId: string;
  userId: string;
  shareWithTeam: boolean;
  introMakerOptIn: boolean;
  retentionDays: number;
  consentedAt: string;
}

export type IntroRequestStatus = "queued" | "sent" | "accepted" | "declined" | "no_response";

export interface IntroRequest {
  id: string;
  orgId: string;
  targetPersonId: string;
  connectorPersonId: string;
  requestedBy: string;
  status: IntroRequestStatus;
  draft?: string;
  createdAt: string;
  updatedAt: string;
}

/** Person + edge rows are org-scoped copies of the shared graph entities. */
export type OrgPerson = Person & { orgId: string };
export type OrgEdge = Edge & { orgId: string };
