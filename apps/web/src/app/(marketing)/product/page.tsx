import type { Metadata } from "next";
import { ProductPage } from "@/components/marketing/product-page";

export const metadata: Metadata = {
  title: { absolute: "Ormes Product" },
  description: "How Ormes decides accept, reject or review, and the tools around the decision.",
  openGraph: { title: "Ormes Product", description: "How Ormes decides accept, reject or review, and the tools around the decision." },
};

export default function Page() {
  return <ProductPage />;
}
