import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { Shell } from "@/components/Shell";
import { Spotlight } from "@/components/motion";

export const metadata: Metadata = {
  title: "SmartCloud Optimizer",
  description: "Turns cloud utilization data into safe, explained cost decisions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Spotlight />
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
