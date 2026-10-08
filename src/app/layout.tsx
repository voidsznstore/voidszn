import type { Metadata, Viewport } from "next";
// Fonts are bundled with the app, so nothing is fetched from a third party at runtime.
import "@fontsource/anton/400.css";
import "@fontsource-variable/archivo/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "VOIDSZN",
    template: "%s | VOIDSZN",
  },
  description: "Nothing is in season. Printed when you order, no logos on the clothes.",
  openGraph: {
    siteName: "VOIDSZN",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
