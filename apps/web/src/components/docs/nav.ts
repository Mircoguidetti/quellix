import {
  BookOpenText,
  Braces,
  Compass,
  GitFork,
  Library,
  ListChecks,
  Plug,
  Rocket,
  UserRoundCheck,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export type DocLink = { href: string; title: string; description: string; icon: LucideIcon };
export type DocGroup = {
  id: "start" | "integrate" | "concepts" | "reference";
  label: string;
  description: string;
  icon: LucideIcon;
  items: DocLink[];
};

/** The docs sidebar, in reading order. Previous / Next follow this order. */
export const DOCS_GROUPS: DocGroup[] = [
  {
    id: "start",
    label: "Start",
    description: "What Ormes does and where to begin.",
    icon: Compass,
    items: [{ href: "/docs", title: "Get started", description: "What the API does and how these docs are organized.", icon: BookOpenText }],
  },
  {
    id: "integrate",
    label: "Integrate",
    description: "Connect your upload pipeline and receive decisions.",
    icon: Plug,
    items: [
      { href: "/docs/quickstart", title: "Quickstart", description: "From an API key to your first decision in five steps.", icon: Rocket },
      { href: "/docs/webhooks", title: "Webhooks", description: "Receive video.decided and verify its signature.", icon: Webhook },
    ],
  },
  {
    id: "concepts",
    label: "Concepts",
    description: "How a spec becomes accept, reject or review.",
    icon: Library,
    items: [
      { href: "/docs/rubrics", title: "Rubrics", description: "Write the lab's spec as checks and thresholds.", icon: ListChecks },
      { href: "/docs/decisions", title: "Decisions", description: "The rule, the reasons and every measurement.", icon: GitFork },
      { href: "/docs/review", title: "Review and contests", description: "Human decisions, lab outcomes and contested rejections.", icon: UserRoundCheck },
    ],
  },
  {
    id: "reference",
    label: "Reference",
    description: "Every endpoint, error and limit.",
    icon: Braces,
    items: [{ href: "/docs/reference", title: "API reference", description: "Endpoints, authentication, errors and limits.", icon: Braces }],
  },
];

export const DOCS_PAGES: (DocLink & { group: DocGroup })[] = DOCS_GROUPS.flatMap((group) => group.items.map((item) => ({ ...item, group })));

export function docNeighbours(href: string) {
  const i = DOCS_PAGES.findIndex((p) => p.href === href);
  return { previous: i > 0 ? DOCS_PAGES[i - 1] : undefined, next: i >= 0 && i < DOCS_PAGES.length - 1 ? DOCS_PAGES[i + 1] : undefined };
}

export function docPage(href: string) {
  const page = DOCS_PAGES.find((p) => p.href === href);
  if (!page) throw new Error(`Unknown docs page ${href}`);
  return page;
}
