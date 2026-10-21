// Usage: QUELLIX_API_KEY=qx_live_... node examples/upload.mjs <rubric_id> <path/to/video.mp4>
import { Quellix } from "@quellix/sdk";

const [rubricId, path] = process.argv.slice(2);
const quellix = new Quellix(); // reads QUELLIX_API_KEY (and QUELLIX_BASE_URL)

const video = await quellix.videos.upload(
  path,
  { rubric_id: rubricId, external_id: path },
  { onProgress: ({ bytesUploaded, totalBytes }) => process.stdout.write(`\r${Math.round((100 * bytesUploaded) / totalBytes)}%`) },
);
console.log(`\nuploaded ${video.id}, waiting for the decision...`);

const decided = await quellix.videos.waitForDecision(video.id);
console.log(decided.status, decided.decision?.decision);
for (const reason of decided.decision?.reasons ?? []) console.log(`- ${reason.code}: ${reason.message}`);
