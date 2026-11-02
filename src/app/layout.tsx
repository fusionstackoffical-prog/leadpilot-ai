import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "LeadPilot AI", template: "%s · LeadPilot AI" },
  description: "HVAC lead generation, qualification, outreach and sales command center.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#070B12",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-app text-fg">{children}</body>
    </html>
  );
}
