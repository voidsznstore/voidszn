"use client";

import { LoadError } from "@/components/site/load-error";

/** A page that failed to load, inside the site's frame. */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  return <LoadError error={error} />;
}
