import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  // Absolute URLs for Open Graph images. siteUrl() never throws, whatever the env holds.
  metadataBase: new URL(siteUrl()),
  title: { default: "Ormes", template: "%s · Ormes" },
  description:
    "Ormes applies your lab's spec to every first-person video you collect and decides accept, reject or review, so your reviewers only see the doubtful cases.",
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="min-h-full font-sans">
        <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
