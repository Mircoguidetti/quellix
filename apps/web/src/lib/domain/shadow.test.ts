import { afterEach, describe, expect, it } from "vitest";
import { ORG, VIDEO, createFakeDb } from "@/test/fake-supabase";
import { getContestInfo } from "./contests";
import { countReviewQueue, listVideos } from "./videos";

// Shadow pilot videos (issue #65) stay out of the customer's lists, but only once the pilots
// migration is live (QUELLIX_PILOTS=1): before that the column does not exist.

afterEach(() => {
  delete process.env.QUELLIX_PILOTS;
});

const shadowFilter = ["eq:shadow", false];

describe("shadow videos", () => {
  it("are left out of the videos list and the review queue when pilots are on", async () => {
    process.env.QUELLIX_PILOTS = "1";
    const fake = createFakeDb((c) => (c.table === "decisions" ? { data: [{ video_id: VIDEO }], error: null } : undefined));
    await listVideos(fake.db, ORG, { limit: 10 });
    await countReviewQueue(fake.db, ORG);
    const videoQueries = fake.calls.filter((c) => c.table === "videos");
    expect(videoQueries).toHaveLength(2);
    for (const q of videoQueries) expect(q.filters).toContainEqual(shadowFilter);
  });

  it("are not filtered before the migration (the column does not exist yet)", async () => {
    const fake = createFakeDb(() => undefined);
    await listVideos(fake.db, ORG, { limit: 10 });
    expect(fake.calls.find((c) => c.table === "videos")!.filters).not.toContainEqual(shadowFilter);
  });

  it("never reach a contributor's contest page", async () => {
    process.env.QUELLIX_PILOTS = "1";
    const fake = createFakeDb((c) => {
      if (c.table === "videos") return { data: { id: VIDEO, org_id: ORG, contributor_ref: "c_1", shadow: true }, error: null };
      if (c.table === "decisions") return { data: { decision: "reject", reasons: [] }, error: null };
      return undefined;
    });
    expect(await getContestInfo(fake.db, VIDEO)).toBeNull();
  });
});
