import { ogImage, ogSize } from "@/components/site/og-image";

export const alt = "Ormes Security";
export const size = ogSize;
export const contentType = "image/png";

export default function Image() {
  return ogImage("Security and data", "How your videos are handled.");
}
