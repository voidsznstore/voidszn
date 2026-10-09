import "server-only";
import { isEmailConfigured } from "@/lib/email/send";
import { unfilledSiteConfig } from "@/lib/site-config";

/** Why a campaign can't be sent to customers yet, in words for the owner. Null when it can. */
export function campaignBlocker(): string | null {
  if (!isEmailConfigured()) return "Email sending isn't set up yet, so campaigns can't go out.";
  if (unfilledSiteConfig().includes("mailingAddress")) {
    return "You can write and test campaigns now, but they can't be sent to customers until your business mailing address is added. The law requires it at the bottom of every marketing email.";
  }
  return null;
}
