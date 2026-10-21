import example from "@quellix/contracts/examples/rubric.load_dishwasher.json";
import { RubricEditor } from "../rubric-editor";

export const metadata = { title: "New rubric · Quellix" };

export default function NewRubricPage() {
  const { name, task, checks } = example;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">New rubric</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Starts from the dishwasher example. Edit every field to match your lab&apos;s spec.</p>
      <RubricEditor initial={{ name, task, checks }} />
    </div>
  );
}
