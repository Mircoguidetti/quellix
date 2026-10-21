import type { components, operations } from "./generated/schema";

type Schemas = components["schemas"];

export type Video = Schemas["Video"];
export type VideoStatus = Schemas["VideoStatus"];
export type DecisionValue = Schemas["DecisionValue"];
export type Decision = Schemas["decision.schema"];
export type CreateVideoRequest = Schemas["CreateVideoRequest"];
export type CreateVideoResponse = Schemas["CreateVideoResponse"];
export type LabOutcome = Schemas["LabOutcome"];
export type Rubric = Schemas["Rubric"];
/** A rubric without `id` and `version`. The contract types `RubricInput.task/checks` as bare objects, so this uses the full rubric schema. */
export type RubricInput = Omit<Rubric, "id" | "version">;

export type ListVideosParams = NonNullable<operations["listVideos"]["parameters"]["query"]>;

export interface ReviewInput {
  decision: "accept" | "reject";
  note?: string;
}

export interface VideoDecidedEvent {
  type: "video.decided";
  created_at: string;
  data: Video;
}
