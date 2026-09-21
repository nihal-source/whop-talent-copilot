import {
  DEFAULT_PERSONAS,
  PERSONAL_SHAPE_WORD_RANGES,
  buildRecipientSegment,
  buildSystemPrompt,
  buildUserPrompt,
  countWords,
  enrichmentTokenFor,
  normalizeCrustdataProfile,
  normalizePersonalStructure,
  parseDraftJson,
  unwrapCrustdataResponse,
  validateDraftSet,
  wordRangeFor,
  type DraftSet,
  type ProfileData,
} from "../src/index";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const profile: ProfileData = {
  linkedinUrl: "https://www.linkedin.com/in/kasyap",
  name: "Kasyap Rao",
  firstName: "Kasyap",
  shortName: "Kasyap",
  headline: "engineer at brief",
  currentCompany: "brief",
  currentTitle: "software engineer",
  location: "New York",
  about: "previously founded sherpa.",
  education: [{ school: "mit" }],
  experience: [
    { company: "brief", title: "software engineer", isCurrent: true },
    { company: "sherpa", title: "founder", isCurrent: false },
  ],
  scrapeHealth: "full",
};
const segment = buildRecipientSegment(profile);

const followUps = {
  followUp1: "hey bumping this — still curious abt the brief infra thing tbh. no stress if timing is bad, just figured i would ask once more. u around this week at all?",
  followUp2: "all good if the timing is off — gonna stop bugging u after this lol. dms stay open if u ever get curious abt whop. keep doing ur thing man",
};

// --- Word ranges: Shape 1 is allowed to run short; nothing is padded to 50 ---
assert(
  PERSONAL_SHAPE_WORD_RANGES.personal_obs_only.max < PERSONAL_SHAPE_WORD_RANGES.personal_obs_value.max,
  "Shape 1 word range is shorter than Shape 2",
);
assert(
  wordRangeFor("initial", { persona: "personal", personalStructure: "personal_obs_only" }).min < 50,
  "Shape 1 initial may be under 50 words",
);
assert(
  wordRangeFor("initialAlt", { persona: "personal", personalStructure: "personal_obs_only" }).max ===
    PERSONAL_SHAPE_WORD_RANGES.personal_obs_value.max,
  "The alternate draft is ranged as the other shape",
);
assert(wordRangeFor("initial", { persona: "founder" }).min === 50, "Founder persona keeps the 50-70 range");

// --- Legacy settings migrate onto the two shapes ---
assert(normalizePersonalStructure("personal_full") === "personal_obs_value", "Retired personal_full maps to Shape 2");
assert(normalizePersonalStructure("personal_obs_only") === "personal_obs_only", "Shape 1 survives normalization");
assert(normalizePersonalStructure(undefined) === "personal_obs_only", "Shape 1 is the default");

// --- Shape 1: observation + question, no pitch ---
const shape1: DraftSet = {
  initial: "yoo kasyap saw ur at brief now after founding sherpa. what made u go back to building inside someone elses company? curious how thats been so far",
  ...followUps,
};
const shape1Result = validateDraftSet(shape1, profile, "", { personalStructure: "personal_obs_only" });
assert(countWords(shape1.initial) < 50, `Shape 1 fixture is genuinely short (${countWords(shape1.initial)} words)`);
assert(shape1Result.valid, "Shape 1 draft set is valid");
assert(
  !shape1Result.warnings.some((w) => w.startsWith("initial:")),
  `Short observation-led Shape 1 draws no warnings (got: ${shape1Result.warnings.join(" | ")})`,
);

// --- The retired pitch is flagged when Shape 1 is asked for ---
const pitched: DraftSet = {
  initial:
    "yoo kasyap ever think abt a higher ceiling than what ur doing at brief rn? we are 75% ex-founders here and somehow unicorn'd with only 60 people. worth a quick chat?",
  ...followUps,
};
const pitchedResult = validateDraftSet(pitched, profile, "", { personalStructure: "personal_obs_only" });
assert(
  pitchedResult.warnings.some((w) => w.includes("Shape 1 should be observation + question only")),
  "The old ceiling/ex-founders pitch is flagged as the wrong shape",
);
assert(
  pitchedResult.warnings.some((w) => w.includes("not an ask for a call")),
  "A call ask in Shape 1 is flagged",
);

// --- Shape 2 may carry one value-prop line ---
const shape2: DraftSet = {
  initial:
    "yoo kasyap noticed u have been on briefs infra since the seed round. we are building out eng at whop rn and the autonomy is genuinely the selling point. worth a quick chat abt it?",
  ...followUps,
};
const shape2Result = validateDraftSet(shape2, profile, "raised a seed round in 2024", {
  personalStructure: "personal_obs_value",
});
assert(
  !shape2Result.warnings.some((w) => w.includes("Shape 1 should be")),
  "A value prop in Shape 2 is not flagged as a wrong shape",
);

// --- Unverifiable credentials are flagged unless the inputs back them up ---
const invented: DraftSet = {
  initial: "yoo kasyap heard u were the #1 rep on ur team and crushed quota last year. how did u pull that off at brief?",
  ...followUps,
};
const inventedResult = validateDraftSet(invented, profile, "", { personalStructure: "personal_obs_only" });
assert(
  inventedResult.warnings.some((w) => w.includes("#1 / top-performer")),
  "An invented #1 ranking is flagged",
);
assert(
  inventedResult.warnings.some((w) => w.includes("quota attainment")),
  "An invented quota claim is flagged",
);
const groundedResult = validateDraftSet(invented, profile, "President's Club 2024, #1 rep of 40, 140% of quota", {
  personalStructure: "personal_obs_only",
});
assert(
  !groundedResult.warnings.some((w) => w.includes("#1 / top-performer") || w.includes("quota attainment")),
  "The same claims pass once the notes establish them",
);

// --- Prompts carry both shapes and retire the old template ---
const personalSystem = buildSystemPrompt(DEFAULT_PERSONAS.personal, segment, "engineering", undefined, "personal_obs_only");
assert(personalSystem.includes("observation → question"), "System prompt names Shape 1");
assert(personalSystem.includes("observation → value prop → question"), "System prompt names Shape 2");
assert(personalSystem.includes("higher ceiling"), "System prompt explicitly retires the old ceiling opener");
assert(
  !personalSystem.includes("MUST be between 50 and 70 words"),
  "Personal persona is no longer forced into the 50-70 range",
);

const founderSystem = buildSystemPrompt(DEFAULT_PERSONAS.founder, segment, "engineering", "founder_subtle_career");
assert(founderSystem.includes("50-70"), "Founder persona still asks for 50-70 words");
assert(!founderSystem.includes("observation → value prop"), "Founder prompt does not inherit the personal shapes");

const personalUser = buildUserPrompt(profile, segment, "", "initial", [], {
  persona: "personal",
  personalStructure: "personal_obs_only",
});
assert(personalUser.includes('"initialAlt"'), "Personal user prompt asks for both shapes");
const founderUser = buildUserPrompt(profile, segment, "", "initial", [], { persona: "founder" });
assert(!founderUser.includes('"initialAlt"'), "Founder user prompt asks for a single initial");

// --- Both shapes survive parsing ---
const parsed = parseDraftJson(
  JSON.stringify({ initial: "a", initialAlt: "b", followUp1: "c", followUp2: "d", reasoning: "x" }),
);
assert(parsed.initialAlt === "b", "parseDraftJson keeps the alternate shape");
assert(parseDraftJson(JSON.stringify({ initial: "a", followUp1: "c", followUp2: "d" })).initialAlt === undefined,
  "parseDraftJson tolerates a response without an alternate");

// --- Crustdata normalization: flat /screener/person/enrich record ---
const crustdataFlat = normalizeCrustdataProfile(
  {
    name: "Kasyap Rao",
    title: "Software Engineer",
    headline: "engineer at brief",
    summary: "previously founded sherpa",
    location: "New York, New York, United States",
    linkedin_profile_url: "https://www.linkedin.com/in/kasyap",
    current_employers: [{ employer_name: "Brief", employee_title: "Software Engineer", start_date: "2023-04-01" }],
    past_employers: [
      { employer_name: "Sherpa", employee_title: "Founder", start_date: "2020-01-01", end_date: "2023-03-01" },
    ],
    education_background: [{ institute_name: "MIT", degree_name: "BS", start_date: "2016-09-01", end_date: "2020-06-01" }],
  },
  "https://www.linkedin.com/in/kasyap",
);
assert(crustdataFlat.name === "Kasyap Rao" && crustdataFlat.firstName === "Kasyap", "Crustdata name normalized");
assert(crustdataFlat.currentCompany === "Brief", "Crustdata current employer normalized");
assert(crustdataFlat.experience.length === 2, "Crustdata current + past employers become experience");
assert(crustdataFlat.experience[1].isCurrent === false, "A past Crustdata role is not marked current");
assert(crustdataFlat.education[0].school === "MIT" && crustdataFlat.education[0].endYear === 2020, "Crustdata education normalized");
assert(crustdataFlat.scrapeHealth === "full", "A complete Crustdata record is full health");

// --- Crustdata normalization: nested /person/enrich match envelope ---
const nested = unwrapCrustdataResponse([
  {
    matched_on: "https://www.linkedin.com/in/kasyap",
    match_type: "professional_network_profile_url",
    matches: [
      {
        confidence_score: 1,
        person_data: {
          basic_profile: {
            name: "Kasyap Rao",
            current_title: "Software Engineer",
            headline: "engineer at brief",
            location: { raw: "New York, United States" },
          },
          experience: { employment_details: { current: [{ name: "Brief", title: "Software Engineer" }], past: [] } },
          education: { schools: [{ school: "MIT", degree: "BS" }] },
        },
      },
    ],
  },
]);
assert(nested !== null, "Nested Crustdata envelope unwraps");
const crustdataNested = normalizeCrustdataProfile(nested!, "https://www.linkedin.com/in/kasyap");
assert(crustdataNested.currentCompany === "Brief", "Nested Crustdata employer normalized");
assert(crustdataNested.location === "New York, United States", "Nested Crustdata location normalized");
assert(unwrapCrustdataResponse([{ matched_on: "x", matches: [] }]) === null, "A no-match response unwraps to null");

// --- Provider token routing ---
assert(
  enrichmentTokenFor("crustdata", { enrichmentApiToken: "apify-token", crustdataApiKey: "crust-key" }) === "crust-key",
  "Crustdata uses its own stored key",
);
assert(
  enrichmentTokenFor("apify", { enrichmentApiToken: "apify-token", crustdataApiKey: "crust-key" }) === "apify-token",
  "Apify still uses the shared enrichment token",
);

console.log(process.exitCode ? "\nSOME TESTS FAILED" : "\nALL TESTS PASSED");
