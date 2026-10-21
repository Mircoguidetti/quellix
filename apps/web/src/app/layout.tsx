import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quellix",
  description:
    "Automated acceptance for robot-training video: your lab's spec applied to every upload.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
