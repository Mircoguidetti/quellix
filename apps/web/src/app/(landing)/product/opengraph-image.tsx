import { ogImage, ogSize } from "@/components/site/og-image";

export const alt = "Ormes Product";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Product", "How Ormes decides.");
}
