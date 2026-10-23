import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EDC Access Management",
  description: "Temporary access management prototype for EDC personnel",
  // Installed on a phone home screen (iPhone uses this icon and title; Android reads app/manifest.ts).
  appleWebApp: { capable: true, title: "EDC Access", statusBarStyle: "default" },
  icons: { apple: "/app-icon/180" },
};

export const viewport: Viewport = { themeColor: "#0D5B7A" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
