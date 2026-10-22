import { ogImage, ogSize } from "@/components/site/og-image";

export const alt = "Ormes";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Automated acceptance", "Stop watching every video before you pay for it.");
}
