import type { Metadata } from "next";
import { DevelopersPage } from "@/components/marketing/developers-page";

export const metadata: Metadata = {
  title: { absolute: "Quellix Developers" },
  description: "The Quellix API, SDKs, decision object and webhooks.",
  openGraph: { title: "Quellix Developers", description: "The Quellix API, SDKs, decision object and webhooks." },
};

export default function Page() {
  return <DevelopersPage />;
}
