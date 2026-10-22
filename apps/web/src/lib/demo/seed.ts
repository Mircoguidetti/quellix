import { randomUUID } from "node:crypto";
import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { evaluate, type CheckName, type CheckOutput } from "@/lib/rubric-eval";
import type { DemoStore, DemoUser, Row } from "./fake-db";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./mode";

/** Deterministic PRNG so every run seeds the same data (relative to "now"). */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_ORG_ID = "6f1c2a8e-3b7d-4c55-9a0e-1f2d3c4b5a60";
export const DEMO_ORG_B_ID = "0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b";
export const DEMO_USER_ID = "d3e0d3e0-0000-4000-8000-000000000001";
const PRIYA_ID = "a1b2c3d4-0000-4000-8000-000000000002";
const TOMAS_ID = "a1b2c3d4-0000-4000-8000-000000000003";
const ENGINE = "worker@0.3.0";
const DAY = 24 * 60 * 60 * 1000;

type Rubric = { id: string; name: string; versions: Row[] };
type Body = { checks: Record<string, Record<string, unknown>> } & Row;

function rubricBody(id: string, version: number, name: string, task: Row, checks: Record<string, Record<string, unknown>>): Body {
  return { id, version, name, task, checks };
}

const dishwasher = example.checks as Record<string, Record<string, unknown>>;

function buildRubrics(rand: () => number): Rubric[] {
  const r1 = randomUuid(rand);
  const r2 = randomUuid(rand);
  const r3 = randomUuid(rand);
  const dishTask = example.task as Row;
  const versions1 = [
    rubricBody(r1, 1, "Load the dishwasher", dishTask, { ...dishwasher, hands_visible: { ...dishwasher.hands_visible, min_ratio: 0.75 }, technical: { ...dishwasher.technical, min_duration_s: 15 } }),
    rubricBody(r1, 2, "Load the dishwasher", dishTask, { ...dishwasher, technical: { ...dishwasher.technical, min_duration_s: 15 } }),
    rubricBody(r1, 3, "Load the dishwasher", dishTask, dishwasher),
  ];
  const laundry = rubricBody(r2, 1, "Fold laundry", {
    library_id: "fold_laundry",
    description: "Fold three shirts and a towel on a flat surface and stack them.",
    steps: ["lay the garment flat", "fold sleeves in", "fold in half", "stack"],
    final_state: "a neat stack of folded clothes",
  }, { ...dishwasher, hands_visible: { ...dishwasher.hands_visible, min_ratio: 0.85 }, privacy: { enabled: true, faces: "review", documents: "ignore", screens: "review" } });
  const coffee = [
    rubricBody(r3, 1, "Make pour-over coffee", {
      description: "Grind beans, rinse the filter, pour water in three stages and serve the cup.",
      steps: ["grind beans", "rinse filter", "bloom", "pour", "serve"],
    }, { ...dishwasher, framing: { ...dishwasher.framing, critical: false, max_unstable_ratio: 0.15 } }),
    rubricBody(r3, 2, "Make pour-over coffee", {
      description: "Grind beans, rinse the filter, pour water in three stages and serve the cup.",
      steps: ["grind beans", "rinse filter", "bloom", "pour", "serve"],
      final_state: "a full cup next to the empty kettle",
    }, { ...dishwasher, framing: { ...dishwasher.framing, critical: false, max_unstable_ratio: 0.15 }, originality: { enabled: true, similarity_threshold: 0.88, on_duplicate: "reject" } }),
  ];
  const now = Date.now();
  const stamp = (versions: Body[], ageDays: number[]) =>
    versions.map((body, i) => ({
      rubric_id: body.id,
      version: body.version,
      body,
      created_by: DEMO_USER_ID,
      created_at: new Date(now - ageDays[i] * DAY).toISOString(),
    }));
  return [
    { id: r1, name: "Load the dishwasher", versions: stamp(versions1, [40, 21, 9]) },
    { id: r2, name: "Fold laundry", versions: stamp([laundry], [18]) },
    { id: r3, name: "Make pour-over coffee", versions: stamp(coffee, [30, 12]) },
  ];
}

function randomUuid(rand: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

type Scenario = "clean" | "hands" | "not_done" | "duplicate" | "short" | "blurry" | "face" | "document" | "uncertain" | "framing" | "hands_error";

function pickScenario(rand: () => number): Scenario {
  const x = rand();
  const table: [number, Scenario][] = [
    [0.7, "clean"], [0.79, "hands"], [0.83, "not_done"], [0.855, "duplicate"], [0.865, "short"], [0.875, "blurry"],
    [0.915, "face"], [0.935, "document"], [0.96, "uncertain"], [0.985, "framing"], [1, "hands_error"],
  ];
  return table.find(([p]) => x < p)![1];
}

/** Plausible check outputs for one video, following the worker's measurement contract. */
export function makeOutputs(rand: () => number, scenario: Scenario, priorVideo?: string): { outputs: Partial<Record<CheckName, CheckOutput>>; duration: number } {
  const duration = scenario === "short" ? 8 + Math.floor(rand() * 8) : 28 + Math.floor(rand() * 140);
  const start = round(1 + rand() * 4, 1);
  const end = round(duration - 1 - rand() * 4, 1);
  const segA = round(start + 1, 1);
  const segB = round(Math.min(end, segA + duration * 0.4), 1);
  const handsRatio = scenario === "hands" ? round(0.42 + rand() * 0.3, 2) : round(0.84 + rand() * 0.15, 2);
  const outputs: Partial<Record<CheckName, CheckOutput>> = {
    task_completed: {
      model: "tasks@0.2.1",
      measurements: {
        completed: scenario !== "not_done",
        confidence: scenario === "uncertain" ? round(0.45 + rand() * 0.2, 2) : round(0.8 + rand() * 0.19, 2),
        start_s: start,
        end_s: scenario === "not_done" ? round(duration * 0.55, 1) : end,
        steps: [
          { name: "start", t_s: start },
          { name: "main action", t_s: round((start + end) / 2, 1) },
          { name: "finish", t_s: end },
        ],
      },
    },
    hands_visible:
      scenario === "hands_error"
        ? { error: "hands model timed out", model: "hands@0.1.0" }
        : {
            model: "hands@0.1.0",
            measurements: {
              ratio_both_manipulation: handsRatio,
              ratio_any_manipulation: round(Math.min(1, handsRatio + 0.08), 2),
              ratio_both_whole: round(handsRatio - 0.06, 2),
              ratio_any_whole: round(Math.min(1, handsRatio + 0.02), 2),
              manipulation_segments: [[segA, segB], [round(segB + 2, 1), round(Math.min(end, segB + 2 + duration * 0.3), 1)]],
            },
          },
    framing: {
      model: "framing@0.1.0",
      measurements: {
        off_target_ratio: scenario === "framing" ? round(0.18 + rand() * 0.15, 3) : round(rand() * 0.06, 3),
        unstable_ratio: round(rand() * 0.07, 3),
      },
    },
    technical: {
      model: "technical@0.1.0",
      measurements: {
        decodable: true,
        duration_s: duration,
        width: 1920,
        height: 1080,
        fps: rand() < 0.2 ? 60 : 30,
        blur_ratio: scenario === "blurry" ? round(0.12 + rand() * 0.1, 3) : round(rand() * 0.03, 3),
        bad_exposure_ratio: round(rand() * 0.04, 3),
      },
    },
    privacy: {
      model: "privacy@0.1.0",
      measurements: {
        faces: scenario === "face" ? [{ t_s: round(duration * (0.2 + rand() * 0.5), 1), box: [0.62, 0.08, 0.14, 0.2] }, { t_s: round(duration * 0.8, 1) }] : [],
        documents: scenario === "document" ? [{ t_s: round(duration * (0.3 + rand() * 0.4), 1), box: [0.1, 0.55, 0.22, 0.18] }] : [],
        screens: [],
      },
    },
    originality: {
      model: "pdq+dinov2@0.1.0",
      measurements: {
        max_similarity: scenario === "duplicate" ? round(0.94 + rand() * 0.05, 2) : round(0.05 + rand() * 0.35, 2),
        match_video_id: scenario === "duplicate" ? priorVideo ?? null : null,
      },
    },
  };
  return { outputs, duration };
}

const CONTEST_MESSAGES = [
  "Both hands were in frame the whole time. The camera was strapped to my head and I checked the preview before starting.",
  "I recorded this in my own kitchen yesterday. It is not a copy of an older video, I have the original file on my phone.",
  "The last step happened off screen for two seconds but the dishwasher was closed at the end. Please take another look.",
];

export function seedDemo(): DemoStore {
  const rand = prng(20261021);
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const users: DemoUser[] = [
    { id: DEMO_USER_ID, email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Alex Morgan", confirmed: true },
    { id: PRIYA_ID, email: "priya@northwind-capture.com", password: randomUUID(), name: "Priya Raman", confirmed: true },
    { id: TOMAS_ID, email: "tomas@northwind-capture.com", password: randomUUID(), name: "Tomás Ortega", confirmed: true },
  ];
  const tables: Record<string, Row[]> = {
    organizations: [
      { id: DEMO_ORG_ID, name: "Northwind Capture", training_opt_in: false, allow_external_models: false, created_at: iso(now - 60 * DAY) },
      { id: DEMO_ORG_B_ID, name: "Northwind Labs EU", training_opt_in: false, allow_external_models: true, created_at: iso(now - 20 * DAY) },
    ],
    members: [
      { org_id: DEMO_ORG_ID, user_id: DEMO_USER_ID, role: "owner", created_at: iso(now - 60 * DAY) },
      { org_id: DEMO_ORG_ID, user_id: PRIYA_ID, role: "admin", created_at: iso(now - 50 * DAY) },
      { org_id: DEMO_ORG_ID, user_id: TOMAS_ID, role: "reviewer", created_at: iso(now - 32 * DAY) },
      { org_id: DEMO_ORG_B_ID, user_id: DEMO_USER_ID, role: "admin", created_at: iso(now - 20 * DAY) },
    ],
    rubrics: [],
    rubric_versions: [],
    videos: [],
    decisions: [],
    reviews: [],
    lab_outcomes: [],
    contests: [],
    jobs: [],
    api_keys: [
      { id: randomUuid(rand), org_id: DEMO_ORG_ID, name: "Production ingest", prefix: "orm_live_N4wB7c", key_hash: "a".repeat(64), created_by: DEMO_USER_ID, created_at: iso(now - 45 * DAY), last_used_at: iso(now - 3 * 60 * 1000), revoked_at: null },
      { id: randomUuid(rand), org_id: DEMO_ORG_ID, name: "Staging", prefix: "orm_live_s9Lm2Q", key_hash: "b".repeat(64), created_by: PRIYA_ID, created_at: iso(now - 38 * DAY), last_used_at: iso(now - 9 * DAY), revoked_at: iso(now - 8 * DAY) },
    ],
    webhooks: [
      { id: randomUuid(rand), org_id: DEMO_ORG_ID, url: "https://ops.northwind-capture.com/hooks/ormes", active: true, signing_secret: "whsec_demo", created_at: iso(now - 44 * DAY) },
    ],
  };

  const seedOrg = (orgId: string, perDay: number) => {
    const rubrics = buildRubrics(rand).slice(0, orgId === DEMO_ORG_ID ? 3 : 1);
    for (const r of rubrics) {
      tables.rubrics.push({ id: r.id, org_id: orgId, name: r.name, current_version: r.versions.length, created_at: r.versions[0].created_at });
      tables.rubric_versions.push(...r.versions);
    }
    const startToday = new Date(now);
    startToday.setUTCHours(0, 0, 0, 0);
    let externalSeq = orgId === DEMO_ORG_ID ? 88000 : 12000;
    const delivered: string[] = [];
    for (let day = 13; day >= 0; day--) {
      const dayStart = startToday.getTime() - day * DAY;
      const weekday = new Date(dayStart).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      let count = Math.round(perDay * (weekend ? 0.55 : 1) * (0.85 + rand() * 0.3) * (1 + (13 - day) * 0.02));
      // Today: spread a realistic share over the hours elapsed so far (at least a handful).
      const windowEnd = day === 0 ? now - 60 * 1000 : dayStart + DAY;
      const windowStart = day === 0 ? Math.min(dayStart + 7 * 3600 * 1000, now - 50 * 60 * 1000) : dayStart + 7 * 3600 * 1000;
      if (day === 0) count = Math.max(Math.round(count * 0.6), 24);
      for (let i = 0; i < count; i++) {
        const created = Math.round(windowStart + rand() * Math.max(windowEnd - windowStart, 30 * 60 * 1000));
        if (created > now) continue;
        const rubric = rubrics[Math.floor(rand() * rubrics.length)];
        const version = rubric.versions.findLast((v) => Date.parse(v.created_at as string) <= created) ?? rubric.versions[0];
        const body = version.body as Body;
        const id = randomUuid(rand);
        externalSeq += 1 + Math.floor(rand() * 3);
        const externalId = `v_${externalSeq}`;
        const contributor = `c_${4000 + Math.floor(rand() * 900)}`;
        const recent = now - created < 25 * 60 * 1000 && day === 0;
        const status = recent && rand() < 0.5 ? (rand() < 0.5 ? "processing" : "queued") : day === 0 && i === 3 ? "failed" : "decided";
        const scenario = pickScenario(rand);
        const { outputs, duration } = makeOutputs(rand, scenario, delivered.length ? delivered[Math.floor(rand() * delivered.length)] : undefined);
        delivered.push(externalId);
        const decisionAt = created + (20 + rand() * 50) * 1000;
        const evaluation = evaluate(body, outputs);
        const pendingReview = evaluation.decision === "review" && now - created < 1.6 * DAY;
        tables.videos.push({
          id,
          org_id: orgId,
          external_id: externalId,
          contributor_ref: contributor,
          rubric_id: rubric.id,
          rubric_version: version.version,
          status,
          storage_path: status === "failed" || (status === "decided" && !pendingReview) ? null : `org/${orgId}/${id}/${externalId}.mp4`,
          filename: `${externalId}.mp4`,
          content_type: "video/mp4",
          size_bytes: Math.round(duration * 1.1e6),
          duration_s: status === "decided" ? duration : null,
          created_at: iso(created),
          file_deleted_at: status === "decided" && !pendingReview ? iso(decisionAt) : null,
        });
        if (status === "failed") {
          tables.jobs.push({
            id: randomUuid(rand),
            video_id: id,
            status: "failed",
            attempts: 3,
            error: "the file could not be decoded after 3 attempts",
            queued_at: iso(created),
            finished_at: iso(created + 5 * 60 * 1000),
          });
        }
        if (status !== "decided") continue;
        tables.decisions.push({
          id: randomUuid(rand),
          video_id: id,
          org_id: orgId,
          decision: evaluation.decision,
          reasons: evaluation.reasons,
          checks: evaluation.checks,
          rubric_id: rubric.id,
          rubric_version: version.version,
          engine_version: ENGINE,
          created_at: iso(decisionAt),
        });
        if (evaluation.decision === "review" && !pendingReview) {
          const accept = rand() < 0.78;
          tables.reviews.push({
            id: randomUuid(rand),
            video_id: id,
            org_id: orgId,
            reviewer_id: rand() < 0.5 ? PRIYA_ID : TOMAS_ID,
            decision: accept ? "accept" : "reject",
            note: accept ? null : "Hands leave the frame while loading the top rack.",
            created_at: iso(decisionAt + (1 + rand() * 5) * 3600 * 1000),
          });
        }
        if (day >= 3 && rand() < 0.3) {
          const final = evaluation.decision === "review" ? (rand() < 0.8 ? "accept" : "reject") : evaluation.decision;
          const disagree = rand() < 0.06;
          tables.lab_outcomes.push({
            video_id: id,
            org_id: orgId,
            outcome: disagree ? (final === "accept" ? "reject" : "accept") : final,
            reason: null,
            received_at: iso(created + 2 * DAY),
          });
        }
      }
    }
  };

  seedOrg(DEMO_ORG_ID, 46);
  seedOrg(DEMO_ORG_B_ID, 6);

  // Contests on three rejected videos of the main organization.
  const rejected = tables.decisions
    .filter((d) => d.org_id === DEMO_ORG_ID && d.decision === "reject")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  [rejected[2], rejected[9], rejected[30]].filter(Boolean).forEach((d, i) => {
    const video = tables.videos.find((v) => v.id === d.video_id)!;
    const created = Date.parse(d.created_at as string) + (3 + i * 5) * 3600 * 1000;
    tables.contests.push({
      id: randomUuid(rand),
      video_id: video.id,
      org_id: DEMO_ORG_ID,
      contributor_ref: video.contributor_ref,
      message: CONTEST_MESSAGES[i],
      status: i === 2 ? "overturned" : "open",
      resolution_note: i === 2 ? "Reviewed the original file: the last step is visible. Paid." : null,
      resolved_by: i === 2 ? PRIYA_ID : null,
      created_at: iso(Math.min(created, now - 10 * 60 * 1000)),
      resolved_at: i === 2 ? iso(Math.min(created + 5 * 3600 * 1000, now - 5 * 60 * 1000)) : null,
    });
  });

  return { tables, users };
}
