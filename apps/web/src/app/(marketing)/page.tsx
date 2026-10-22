import type { Metadata } from "next";
import { HomePage } from "@/components/site/home/home-page";

export const metadata: Metadata = {
  title: { absolute: "Ormes" },
  description: "Ormes applies your lab’s spec to every first-person video you collect and decides accept, reject or review.",
  openGraph: { title: "Ormes", description: "Ormes applies your lab’s spec to every first-person video you collect and decides accept, reject or review." },
};

export default function Page() {
  return <HomePage />;
}
