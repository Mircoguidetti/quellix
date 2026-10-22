// Usage: ORMES_API_KEY=orm_live_... node examples/upload.mjs <rubric_id> <path/to/video.mp4>
import { Ormes } from "@ormes/sdk";

const [rubricId, path] = process.argv.slice(2);
const ormes = new Ormes(); // reads ORMES_API_KEY (and ORMES_BASE_URL)

const video = await ormes.videos.upload(
  path,
  { rubric_id: rubricId, external_id: path },
  { onProgress: ({ bytesUploaded, totalBytes }) => process.stdout.write(`\r${Math.round((100 * bytesUploaded) / totalBytes)}%`) },
);
console.log(`\nuploaded ${video.id}, waiting for the decision...`);

const decided = await ormes.videos.waitForDecision(video.id);
console.log(decided.status, decided.decision?.decision);
for (const reason of decided.decision?.reasons ?? []) console.log(`- ${reason.code}: ${reason.message}`);
