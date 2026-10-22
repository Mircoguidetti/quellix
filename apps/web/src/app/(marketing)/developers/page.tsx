import type { Metadata } from "next";
import { DevelopersPage } from "@/components/marketing/developers-page";

export const metadata: Metadata = {
  title: { absolute: "Ormes Developers" },
  description: "The Ormes API, SDKs, decision object and webhooks.",
  openGraph: { title: "Ormes Developers", description: "The Ormes API, SDKs, decision object and webhooks." },
};

export default function Page() {
  return <DevelopersPage />;
}
