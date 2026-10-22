import { ogImage, ogSize } from "@/components/marketing/og-image";

export const alt = "Ormes Security";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Security and data", "Videos are checked, not kept.");
}
