import "server-only";
import { randomUUID } from "node:crypto";
import { evaluate } from "@/lib/rubric-eval";
import { createFakeClient, type DemoStore, type Row } from "./fake-db";
import { makeOutputs, seedDemo } from "./seed";

const globalForDemo = globalThis as unknown as { __quellixDemo?: DemoStore };

/** One store per server process, so changes made in the demo survive navigation. */
export function demoStore(): DemoStore {
  if (!globalForDemo.__quellixDemo) {
    const store = seedDemo();
    store.onEnqueue = (message) => simulateWorker(store, message.video_id);
    globalForDemo.__quellixDemo = store;
  }
  return globalForDemo.__quellixDemo;
}

export function demoClient() {
  return createFakeClient(demoStore());
}

/** Pretend to be the worker: a few seconds after an upload, write a decision. */
function simulateWorker(store: DemoStore, videoId: string) {
  const video = store.tables.videos.find((v) => v.id === videoId);
  if (!video) return;
  setTimeout(() => {
    video.status = "processing";
  }, 1200);
  setTimeout(() => {
    const version = store.tables.rubric_versions.find((v) => v.rubric_id === video.rubric_id && v.version === video.rubric_version);
    let seed = 0;
    for (const ch of videoId) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    const rand = () => ((seed = (seed * 1103515245 + 12345) | 0) >>> 0) / 4294967296;
    const { outputs, duration } = makeOutputs(rand, rand() < 0.6 ? "clean" : rand() < 0.5 ? "face" : "hands");
    const evaluation = evaluate((version?.body as { checks?: Record<string, unknown> }) ?? {}, outputs);
    const decision: Row = {
      id: randomUUID(),
      video_id: videoId,
      org_id: video.org_id,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      checks: evaluation.checks,
      rubric_id: video.rubric_id,
      rubric_version: video.rubric_version,
      engine_version: "worker@0.3.0",
      created_at: new Date().toISOString(),
    };
    store.tables.decisions.push(decision);
    Object.assign(video, { status: "decided", duration_s: duration });
    if (evaluation.decision !== "review") Object.assign(video, { storage_path: null, file_deleted_at: new Date().toISOString() });
  }, 4500);
}
