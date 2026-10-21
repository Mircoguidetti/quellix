// Shared Tailwind class strings. Quiet, dark-mode aware.
export const input =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400";

export function button(kind: "primary" | "secondary" | "danger" = "primary") {
  const base =
    "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-50";
  const kinds = {
    primary: "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300",
    secondary:
      "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return `${base} ${kinds[kind]}`;
}

export const card = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
export const muted = "text-zinc-600 dark:text-zinc-400";

const badgeTones: Record<string, string> = {
  accept: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  reject: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function badge(tone: string) {
  return `inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeTones[tone] ?? badgeTones.neutral}`;
}
