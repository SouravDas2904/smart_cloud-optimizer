import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";
import { Shell } from "@/components/Shell";
import { Spotlight } from "@/components/Spotlight";

export const metadata: Metadata = {
  title: "SmartCloud Optimizer",
  description: "Turns cloud utilization data into safe, explained cost decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Spotlight />
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
