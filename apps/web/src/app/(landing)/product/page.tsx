import type { Metadata } from "next";
import { Product } from "@/components/site/landing/product";

export const metadata: Metadata = {
  title: { absolute: "Ormes Product" },
  description: "How Ormes decides accept, reject or review, and the tools around the decision.",
  openGraph: { title: "Ormes Product", description: "How Ormes decides accept, reject or review, and the tools around the decision." },
};

export default function Page() {
  return <Product />;
}
