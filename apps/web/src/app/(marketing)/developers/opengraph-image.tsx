import { ogImage, ogSize } from "@/components/marketing/og-image";

export const alt = "Quellix Developers";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Developers", "Three calls from upload to decision.");
}
