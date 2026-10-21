import type { Metadata } from "next";
import { HomePage } from "@/components/marketing/index-page";

export const metadata: Metadata = {
  title: { absolute: "Quellix" },
  description: "Quellix applies your lab’s spec to every first-person video you collect and decides accept, reject or review.",
  openGraph: { title: "Quellix", description: "Quellix applies your lab’s spec to every first-person video you collect and decides accept, reject or review." },
};

export default function Page() {
  return <HomePage />;
}
