import type { HttpClient } from "../http";
import type { LabOutcome, ReviewInput, Rubric, RubricInput, Video } from "../types";

type Opts = { signal?: AbortSignal };

export class Review {
  constructor(private readonly http: HttpClient) {}

  /** Records a human reviewer's final decision. */
  submit(videoId: string, input: ReviewInput, options: Opts = {}): Promise<Video> {
    return this.http.request("POST", `/videos/${encodeURIComponent(videoId)}/review`, { body: input, ...options });
  }
}

export class LabOutcomes {
  constructor(private readonly http: HttpClient) {}

  /** Records what the lab decided, used to measure Quellix's precision. */
  submit(videoId: string, input: LabOutcome, options: Opts = {}): Promise<Video> {
    return this.http.request("POST", `/videos/${encodeURIComponent(videoId)}/lab-outcome`, { body: input, ...options });
  }
}

export class Rubrics {
  constructor(private readonly http: HttpClient) {}

  /** Creates a rubric (version 1). */
  create(input: RubricInput, options: Opts = {}): Promise<Rubric> {
    return this.http.request("POST", "/rubrics", { body: input, ...options });
  }

  /** Latest version, or a specific one with `version`. */
  get(rubricId: string, params: { version?: number } = {}, options: Opts = {}): Promise<Rubric> {
    return this.http.request("GET", `/rubrics/${encodeURIComponent(rubricId)}`, { query: params, ...options });
  }

  /** Latest version of every rubric. */
  async list(options: Opts = {}): Promise<Rubric[]> {
    const page = await this.http.request<{ data: Rubric[] }>("GET", "/rubrics", options);
    return page.data;
  }

  /** Saves a new version; old versions are kept. */
  newVersion(rubricId: string, input: RubricInput, options: Opts = {}): Promise<Rubric> {
    return this.http.request("PUT", `/rubrics/${encodeURIComponent(rubricId)}`, { body: input, ...options });
  }
}
