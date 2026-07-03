import {
  IntroGraph,
  buildIntroFacts,
  draftIntroRequest,
  normalizeName,
  parseInstagramFollows,
  parseLinkedInConnections,
  parseTwitterArchiveFollows,
  rankIntroPaths,
  validateIntroDraft,
  type Person,
} from "../src/index";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

// --- LinkedIn Connections.csv parsing (with the "Notes:" preamble) ---
const csv = [
  "Notes:",
  '"When exporting your connection data..."',
  "",
  "First Name,Last Name,URL,Email Address,Company,Position",
  "Alex,Rivera,https://www.linkedin.com/in/alexrivera,,Stripe,Head of Sales",
  "Sam,Chen,https://www.linkedin.com/in/samchen,,Ramp,Engineer",
  '"Bad,Name",Person,https://www.linkedin.com/in/badname,,"Acme, Inc",CEO',
].join("\n");
const li = parseLinkedInConnections(csv);
assert(li.contacts.length === 3, `LinkedIn parsed 3 contacts (got ${li.contacts.length})`);
assert(li.contacts[0].accounts[0].handle === "alexrivera", "LinkedIn handle normalized from URL");
assert(li.contacts[2].company === "Acme, Inc", "CSV quoted comma company preserved");

// --- X archive parsing ---
const xjs =
  'window.YTD.following.part0 = [ {"following":{"accountId":"1","userLink":"https://twitter.com/alexrivera"}}, {"following":{"accountId":"2","userLink":"https://twitter.com/dana"}} ]';
const x = parseTwitterArchiveFollows(xjs, "following");
assert(x.contacts.length === 2, `X parsed 2 follows (got ${x.contacts.length})`);
assert(x.contacts[0].accounts[0].handle === "alexrivera", "X handle from userLink");

// --- Instagram export parsing ---
const igjson = JSON.stringify([
  { string_list_data: [{ value: "alexrivera", href: "https://instagram.com/alexrivera" }] },
]);
const ig = parseInstagramFollows(igjson, "follower");
assert(ig.contacts.length === 1, "IG parsed 1 follower");

// --- Graph build + identity merge across platforms ---
const graph = new IntroGraph();
const me: Person = {
  id: "me",
  name: "Jordan Lee",
  normalizedName: normalizeName("Jordan Lee"),
  accounts: [],
  resolution: "user_confirmed",
  resolutionConfidence: 1,
};
graph.loadPerson(me);
graph.ingestContacts("me", "user_me", li.contacts);
graph.ingestContacts("me", "user_me", x.contacts);

const alex = graph.findPersonByHandle("linkedin", "alexrivera");
assert(!!alex, "Alex resolved as a person");
// Safety: a coincidental same username across platforms must NOT fuse identities.
const alexX = graph.findPersonByHandle("x", "alexrivera");
assert(!!alexX && !!alex && alex.id !== alexX.id, "Cross-platform username coincidence does NOT merge");

// But re-importing the same LinkedIn handle merges (same platform + handle).
const before = graph.allPersons().length;
graph.ingestContacts("me", "user_me", [
  {
    name: "Alex Rivera",
    accounts: [{ platform: "linkedin", handle: "alexrivera", url: "https://www.linkedin.com/in/alexrivera" }],
    edgeType: "connection",
    source: "linkedin_export",
    confidence: 0.9,
    evidence: [],
  },
]);
assert(graph.allPersons().length === before, "Re-importing same LinkedIn handle does not create a duplicate");

// --- Target + scoring ---
const target: Person = {
  id: "target",
  name: "Taylor Fox",
  normalizedName: normalizeName("Taylor Fox"),
  accounts: [],
  company: "Stripe",
  title: "VP Engineering",
  resolution: "pdl",
  resolutionConfidence: 0.9,
};
graph.loadPerson(target);
// Confirmed edge: Alex (connection of me) knows Taylor.
graph.loadEdge({
  id: "e_alex_taylor",
  fromPersonId: alex!.id,
  toPersonId: "target",
  type: "connection",
  source: "linkedin_export",
  confidence: 0.9,
  evidence: [{ kind: "comment", platform: "linkedin", timestamp: "2025-01-01" }],
  contributedBy: "user_alex",
  observedAt: new Date().toISOString(),
});

const paths = rankIntroPaths(graph, "target", {
  teamMemberIds: new Set(["me"]),
  optedInIds: new Set([alex!.id]),
});
assert(paths.length >= 1, `Found >=1 intro path (got ${paths.length})`);
assert(paths[0].connectorId === alex!.id, "Top connector is Alex");
assert(paths[0].veracity === "confirmed", "Alex->Taylor is confirmed");

// --- A genuinely weak inferred-only path (no company overlap, weak tie to you) is suppressed ---
const weak = new IntroGraph();
weak.loadPerson(me);
weak.loadPerson({ ...target, company: "Stripe" });
weak.loadPerson({
  id: "cw2",
  name: "Robin Doe",
  normalizedName: normalizeName("Robin Doe"),
  accounts: [],
  company: "Unrelated Co",
  title: "Analyst",
  resolution: "pdl",
  resolutionConfidence: 0.6,
});
weak.loadEdge({
  id: "e_me_cw2",
  fromPersonId: "me",
  toPersonId: "cw2",
  type: "follows",
  source: "x_export",
  confidence: 0.5,
  evidence: [],
  contributedBy: "user_me",
  observedAt: new Date().toISOString(),
});
weak.loadEdge({
  id: "e_cw2_target",
  fromPersonId: "cw2",
  toPersonId: "target",
  type: "coworker_inferred",
  source: "pdl_inferred",
  confidence: 0.3,
  evidence: [{ kind: "shared_employer", platform: "linkedin", rawRef: "Stripe" }],
  contributedBy: "system_inference",
  observedAt: new Date().toISOString(),
});
const weakPaths = rankIntroPaths(weak, "target", { teamMemberIds: new Set(["me"]) });
assert(weakPaths.length === 0, "Weak inferred-only path is suppressed by the higher inferred bar");

// --- A useful inferred path (same employer + strong tie to you) surfaces, labeled "likely" ---
const useful = new IntroGraph();
useful.loadPerson(me);
useful.loadPerson(target);
useful.loadPerson({
  id: "cw3",
  name: "Pat Kim",
  normalizedName: normalizeName("Pat Kim"),
  accounts: [],
  company: "Stripe",
  title: "Engineer",
  resolution: "pdl",
  resolutionConfidence: 0.7,
});
useful.loadEdge({
  id: "e_me_cw3",
  fromPersonId: "me",
  toPersonId: "cw3",
  type: "connection",
  source: "linkedin_export",
  confidence: 0.9,
  evidence: [],
  contributedBy: "user_me",
  observedAt: new Date().toISOString(),
});
useful.loadEdge({
  id: "e_cw3_target",
  fromPersonId: "cw3",
  toPersonId: "target",
  type: "coworker_inferred",
  source: "pdl_inferred",
  confidence: 0.3,
  evidence: [{ kind: "shared_employer", platform: "linkedin", rawRef: "Stripe" }],
  contributedBy: "system_inference",
  observedAt: new Date().toISOString(),
});
const usefulPaths = rankIntroPaths(useful, "target", { teamMemberIds: new Set(["me"]) });
assert(usefulPaths.length === 1 && usefulPaths[0].veracity === "likely", "Useful inferred path surfaces, labeled likely");

// --- Intro draft grounding ---
const facts = buildIntroFacts(graph, paths[0]);
const draft = draftIntroRequest(facts, "hiring a founding engineer");
const v1 = validateIntroDraft(draft, facts);
assert(v1.valid, "Grounded draft validates");
const bad = validateIntroDraft("You and Taylor are close friends, right?", facts);
assert(!bad.valid, "Overclaim draft is rejected");

// --- Inferred path may not be described as a "mutual" connection ---
const inferredFacts = buildIntroFacts(useful, usefulPaths[0]);
assert(!inferredFacts.relationshipConfirmed, "Inferred path facts are marked unconfirmed");
const mutualClaim = validateIntroDraft("You have a mutual connection with Taylor Fox.", inferredFacts);
assert(!mutualClaim.valid, "Cannot claim 'mutual' on an inferred path");

// --- Freshness: a stale confirmed edge scores below an identical fresh one ---
function scoreWithAge(daysAgo: number): number {
  const g = new IntroGraph();
  g.loadPerson(me);
  g.loadPerson(target);
  const conn: Person = { id: "cx", name: "Casey", normalizedName: "casey", accounts: [], resolution: "export", resolutionConfidence: 0.9 };
  g.loadPerson(conn);
  const observedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  g.loadEdge({ id: "e1", fromPersonId: "me", toPersonId: "cx", type: "connection", source: "linkedin_export", confidence: 0.9, evidence: [], contributedBy: "u", observedAt });
  g.loadEdge({ id: "e2", fromPersonId: "cx", toPersonId: "target", type: "connection", source: "linkedin_export", confidence: 0.9, evidence: [], contributedBy: "u", observedAt });
  const r = rankIntroPaths(g, "target", { teamMemberIds: new Set(["me"]) });
  return r[0]?.breakdown.composite ?? 0;
}
assert(scoreWithAge(400) < scoreWithAge(1), "Stale edges score below fresh edges");

// --- Consent: an opted-in connector scores higher on risk/consent than an unknown one ---
function scoreWithOptIn(optedIn: boolean): number {
  const g = new IntroGraph();
  g.loadPerson(me);
  g.loadPerson(target);
  const conn: Person = { id: "cy", name: "Devin", normalizedName: "devin", accounts: [], resolution: "export", resolutionConfidence: 0.9 };
  g.loadPerson(conn);
  const now = new Date().toISOString();
  g.loadEdge({ id: "e3", fromPersonId: "me", toPersonId: "cy", type: "connection", source: "linkedin_export", confidence: 0.9, evidence: [], contributedBy: "u", observedAt: now });
  g.loadEdge({ id: "e4", fromPersonId: "cy", toPersonId: "target", type: "connection", source: "linkedin_export", confidence: 0.9, evidence: [], contributedBy: "u", observedAt: now });
  const r = rankIntroPaths(g, "target", { teamMemberIds: new Set(["me"]), optedInIds: optedIn ? new Set(["cy"]) : new Set() });
  return r[0].breakdown.composite;
}
assert(scoreWithOptIn(true) > scoreWithOptIn(false), "Opted-in connector outranks a non-opted-in one");

console.log(process.exitCode ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
