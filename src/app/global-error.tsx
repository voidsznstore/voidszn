"use client";

import "@fontsource/anton/400.css";
import "@fontsource-variable/archivo/standard.css";
import "./globals.css";
import { LoadError } from "@/components/site/load-error";

/**
 * A failure that takes the whole frame with it, so this supplies its own
 * document. It behaves the same as the ordinary error page: one quiet reload,
 * then a message if that didn't help.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col antialiased">
        <LoadError error={error} />
      </body>
    </html>
  );
}
