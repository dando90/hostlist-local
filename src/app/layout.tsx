import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HostList · Raccolta locale", template: "%s · HostList" },
  description: "Directory locale di profili host con strumenti di analisi.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
