import { ogImage, ogSize } from "@/components/marketing/og-image";

export const alt = "Ormes Product";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Product", "One spec, applied the same way to every video.");
}
