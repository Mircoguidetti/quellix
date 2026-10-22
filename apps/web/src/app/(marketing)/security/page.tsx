import type { Metadata } from "next";
import { SecurityPage } from "@/components/marketing/security-page";

export const metadata: Metadata = {
  title: { absolute: "Ormes Security" },
  description: "How Ormes handles customer video: deletion, retention, training, isolation and providers.",
  openGraph: { title: "Ormes Security", description: "How Ormes handles customer video: deletion, retention, training, isolation and providers." },
};

export default function Page() {
  return <SecurityPage />;
}
