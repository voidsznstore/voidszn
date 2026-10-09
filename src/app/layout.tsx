import type { Metadata, Viewport } from "next";
// Fonts are bundled with the app, so nothing is fetched from a third party at runtime.
import "@fontsource/anton/400.css";
import "@fontsource-variable/archivo/standard.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { CartProvider } from "@/components/cart/cart-provider";
import { CodeLink } from "@/components/cart/code-link";
import { siteConfig } from "@/lib/site-config";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "VOIDSZN",
    template: "%s | VOIDSZN",
  },
  description: "Nothing is in season. Graphic tees and more, printed when you order.",
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
      <body className="flex min-h-full flex-col">
        <CartProvider>{children}</CartProvider>
        <CodeLink />
      </body>
    </html>
  );
}
