import { HttpClient, type ClientOptions } from "./http";
import { LabOutcomes, Review, Rubrics } from "./resources/misc";
import { Videos } from "./resources/videos";
import { constructEvent, verifySignature } from "./webhooks";

export class Quellix {
  readonly videos: Videos;
  readonly review: Review;
  readonly labOutcome: LabOutcomes;
  readonly rubrics: Rubrics;
  readonly webhooks = { verifySignature, constructEvent };

  constructor(options: ClientOptions = {}) {
    const http = new HttpClient(options);
    this.videos = new Videos(http);
    this.review = new Review(http);
    this.labOutcome = new LabOutcomes(http);
    this.rubrics = new Rubrics(http);
  }
}
