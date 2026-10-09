import "server-only";
import { headers } from "next/headers";
import { siteConfig } from "@/lib/site-config";

/** The hosts this deployment itself answers on, as the hosting platform reports them. */
const deploymentHosts = () =>
  [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => host.toLowerCase());

/**
 * The address this request came in on, for links that bring someone back from
 * another site (Stripe's card form). Only ever one of our own addresses: the
 * live site, this deployment's own address, or a local run. Anything else gets
 * the live site, so a forged Host header can't send anyone elsewhere.
 */
export async function ownOrigin(): Promise<string> {
  const host = ((await headers()).get("host") ?? "").toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) return siteConfig.url;
  const hostname = host.split(":")[0];

  // A local run, never the hosted site.
  if (!process.env.VERCEL && (hostname === "localhost" || hostname === "127.0.0.1")) return `http://${host}`;
  const ours = hostname === "voidszn.com" || hostname.endsWith(".voidszn.com") || deploymentHosts().includes(host);
  return ours ? `https://${host}` : siteConfig.url;
}
