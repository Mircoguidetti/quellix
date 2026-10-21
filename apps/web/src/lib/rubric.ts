import Ajv2020 from "ajv/dist/2020";
import schema from "@quellix/contracts/rubric.schema.json";
import { errors } from "@/lib/api/errors";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateFn = ajv.compile(schema);

export type RubricBody = {
  id: string;
  version: number;
  name: string;
  task: Record<string, unknown>;
  checks: Record<string, unknown>;
};

export type RubricInput = Pick<RubricBody, "name" | "task" | "checks">;

/** Returns human-readable errors; empty when the document matches rubric.schema.json. */
export function validateRubric(doc: unknown): string[] {
  if (validateFn(doc)) return [];
  return (validateFn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

/** The server assigns id and version; the client sends only name, task, checks. */
export function buildRubricBody(id: string, version: number, input: RubricInput): RubricBody {
  const body: RubricBody = { id, version, name: input.name, task: input.task, checks: input.checks };
  const problems = validateRubric(body);
  if (problems.length) throw errors.badRequest(`Invalid rubric: ${problems.join("; ")}`);
  return body;
}
