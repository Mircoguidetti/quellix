import { errors } from "@/lib/api/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string) => UUID.test(value);

/** Ids in the URL that are not UUIDs can never exist: answer 404 instead of a database error. */
export function requireUuid(value: string, what = "Resource"): string {
  if (!isUuid(value)) throw errors.notFound(`${what} not found`);
  return value;
}

export const VIDEO_BUCKET = "videos";
export const QUEUE_NAME = "video_jobs";

export function sanitizeFilename(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return clean.slice(0, 200) || "video";
}

export function storagePathFor(orgId: string, videoId: string, filename: string): string {
  return `org/${orgId}/${videoId}/${sanitizeFilename(filename)}`;
}
