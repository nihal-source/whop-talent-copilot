export type TalentTrack = "gtm" | "engineering";
export type OutreachPersona = "personal" | "founder";
export type FounderVariant = "founder_cracked" | "founder_subtle_career" | "founder_subtle_lit" | "founder_direct";
export type PersonalStructure = "personal_full" | "personal_obs_only";
export type FitTier = "strong" | "good" | "weak" | "disqualified";
export type TouchType = "initial" | "follow_up_1" | "follow_up_2" | "follow_up_n" | "objection_handle";
export type OutreachStatus =
  | "drafted"
  | "initial_sent"
  | "follow_up_1_sent"
  | "follow_up_2_sent"
  | "replied"
  | "positive_reply"
  | "closed";

export interface ProfileData {
  linkedinUrl: string;
  name: string;
  firstName: string;
  shortName: string;
  headline: string;
  currentCompany: string;
  currentTitle: string;
  location: string;
  about: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  scrapeHealth: "full" | "partial" | "failed";
}

export interface EducationEntry {
  school: string;
  degree?: string;
  startYear?: number;
  endYear?: number;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  startDate?: string;
  endDate?: string;
  isCurrent: boolean;
}

export interface RecipientSegment {
  roleFamily: "engineering" | "sales" | "finance" | "product" | "design" | "ops" | "other";
  seniority: "junior" | "mid" | "senior" | "staff" | "principal" | "manager" | "director" | "executive" | "unknown";
  currentEmployer: string;
  employerType: "startup" | "big_tech" | "enterprise" | "consulting" | "finance" | "agency" | "unknown";
  industry: string;
  industryBucket: string;
  ageBand: "20s" | "30s" | "40s" | "50s+" | "unknown";
  ageConfidence: "high" | "medium" | "low";
  graduationYear?: number;
  yearsExperience?: number;
  segmentKey: string;
}

export interface TalentSignals {
  isFounderOrExFounder: boolean;
  inferredAge: number | null;
  passesAgeGate: boolean;
  isFoundingSales: boolean;
  isStartupSales: boolean;
  isAgencyOwner: boolean;
  isTier1SalesCompany: boolean;
  isPresidentsClub: boolean;
  isFoundingEngineer: boolean;
  isTier1EngCompany: boolean;
  isIoiMedalist: boolean;
  isImoMedalist: boolean;
  isHackathonWinner: boolean;
  isTargetSchool: boolean;
  isPreSeriesCStartup: boolean;
  isChineseTierCompany: boolean;
  userNotesBoost: string[];
}

export interface TalentFitScore {
  track: TalentTrack;
  score: number;
  tier: FitTier;
  matchedSignals: string[];
  missingSignals: string[];
  ageGate: { max: number; inferred: number | null; passes: boolean };
  signals: TalentSignals;
}

export interface FrameworkStep {
  instruction: string;
  templateLine?: string;
}

export interface MessageFramework {
  initial: { steps: FrameworkStep[]; maxSentences?: number; maxChars?: number };
  followUp1: { steps: FrameworkStep[]; toneShift?: string };
  followUp2: { steps: FrameworkStep[]; toneShift?: string };
}

export interface PersonaConfig {
  id: OutreachPersona;
  label: string;
  styleGuide: { tone: string; length: string; mustInclude: string[]; mustAvoid: string[] };
  framework: MessageFramework;
  senderContext: { name: string; title: string; company: string; pitchLine?: string };
  examples: { initial: string; followUp1: string; followUp2?: string };
  followUpCadenceDays: [number, number];
}

export interface TalentBarConfig {
  gtmAgeCap: number;
  engineeringAgeCap: number;
  engineeringCompanies: string[];
  chineseCompanies: string[];
  gtmSalesCompanies: string[];
  preSeriesCCompanies: string[];
  targetSchools: string[];
  hackathonKeywords: string[];
  gtmWeights: Record<string, number>;
  engineeringWeights: Record<string, number>;
}

export interface DraftSet {
  initial: string;
  followUp1: string;
  followUp2: string;
}

export interface SourcingQueueEntry {
  id: string;
  profile: ProfileData;
  segment: RecipientSegment;
  fitScore: TalentFitScore;
  track: TalentTrack;
  notes: string;
  outreachStatus: "not_contacted" | "in_pipeline" | "replied";
  addedAt: string;
}

export interface OutreachRecord {
  id: string;
  persona: OutreachPersona;
  track: TalentTrack;
  linkedinUrl: string;
  name: string;
  status: OutreachStatus;
  convertingTouch?: TouchType;
  structureVariant?: string;
  founderVariant?: FounderVariant;
  personalStructure?: PersonalStructure;
  drafts: DraftSet;
  sentMessageIds: string[];
  notes: string;
  nextFollowUpDue?: string;
  profile: ProfileData;
  segment: RecipientSegment;
  timestamps: {
    generated: string;
    initialSent?: string;
    followUp1Sent?: string;
    followUp2Sent?: string;
    repliedAt?: string;
    positiveReplyAt?: string;
  };
}

export interface MessageFeatures {
  wordCount: number;
  charCount: number;
  paragraphCount: number;
  persona: OutreachPersona;
  touchType: TouchType;
  structureVariant: string;
  recipientSegment: RecipientSegment;
  usesFirstName: boolean;
  usesShortName: boolean;
  openerType: string;
  openerPhrase: string;
  ctaType: string;
  ctaPhrase: string | null;
  triggerType: string;
  triggerEntity: string | null;
  tonalityTags: string[];
  sentAt: string;
  sentHourLocal: number;
  sentDayOfWeek: number;
  daysSinceLastTouch: number | null;
  gotReply: boolean;
  gotPositiveReply: boolean;
  timeToReplyHours: number | null;
}

export interface OutreachEvent {
  id: string;
  type: "message_sent" | "reply" | "positive_reply" | "objection_received";
  outreachId: string;
  linkedinUrl: string;
  generatedText: string;
  sentText: string;
  editDistance: number;
  features: MessageFeatures;
  recipientSegment: RecipientSegment;
  frameworkVersion: string;
  variationKey: string;
  timestamp: string;
}

export interface DimensionMetrics {
  dimension: string;
  value: string;
  sends: number;
  replies: number;
  positiveReplies: number;
  replyRate: number;
  positiveRate: number;
  positiveOfReplies: number;
  avgTimeToReplyHours: number | null;
}

export interface AppSettings {
  anthropicApiKey: string;
  enrichmentProvider: "none" | "apify";
  enrichmentApiToken: string;
  activePersona: OutreachPersona;
  activeTrack: TalentTrack;
  founderVariant: FounderVariant;
  personalStructure: PersonalStructure;
  talentBar: TalentBarConfig;
  personas: Record<OutreachPersona, PersonaConfig>;
  frameworkVersion: string;
}

export type MessageRequest = {
  type: "SCRAPE_PROFILE";
} | {
  type: "ENRICH_PROFILE";
  url: string;
} | {
  type: "ENRICH_QUEUE";
  force?: boolean;
} | {
  type: "SCORE_PROFILE";
  track: TalentTrack;
  notes?: string;
  profile?: ProfileData;
} | {
  type: "GENERATE_DRAFTS";
  persona: OutreachPersona;
  track: TalentTrack;
  notes: string;
  profile: ProfileData;
  segment: RecipientSegment;
  founderVariant?: FounderVariant;
  personalStructure?: PersonalStructure;
  touchType?: TouchType;
} | {
  type: "PREFILL_COMPOSE";
  text: string;
} | {
  type: "LOG_EVENT";
  event: Omit<OutreachEvent, "id">;
} | {
  type: "GET_METRICS";
  filters?: Record<string, string>;
};

export type MessageResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};
