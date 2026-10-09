/**
 * Checks that a campaign reaches everyone exactly once, even when it is sent
 * from several places at the same moment.
 * Writes test rows, so run it against a scratch database and a stand-in for the
 * email service, never production:
 *   DATABASE_URL=... RESEND_API_KEY=... RESEND_API_URL=http://127.0.0.1:4030 npm run test:campaign
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { saveCampaign, startCampaign } from "../src/db/queries/admin-campaigns";
import { campaignSends, campaigns, customers } from "../src/db/schema";
import { sendCampaign } from "../src/lib/email/campaigns";

const PEOPLE = 250;

async function main() {
  assert.ok(process.env.RESEND_API_URL, "Point RESEND_API_URL at a stand-in, not the real service.");
  const db = getDb();
  const run = randomUUID().slice(0, 8);
  const subject = `Campaign test ${run}`;
  const content = { subject, preheader: "", body: "Hello.", imageUrl: null, buttonLabel: "", buttonUrl: "" };

  await db.insert(customers).values(
    Array.from({ length: PEOPLE }, (_, index) => ({
      email: `c${index}-${run}@example.com`,
      name: `Person ${index}`,
      acceptsEmail: true,
    })),
  );

  // The same new campaign saved twice is one campaign.
  const id = randomUUID();
  const saves = await Promise.all([saveCampaign(db, "test", id, content), saveCampaign(db, "test", id, content)]);
  assert.deepEqual(saves, [true, true]);
  assert.equal((await db.select().from(campaigns).where(eq(campaigns.id, id))).length, 1);
  console.log("  ok  saving the same new campaign twice makes one campaign");

  await Promise.all([startCampaign(db, id), startCampaign(db, id)]);
  const queued = await db.select().from(campaignSends).where(eq(campaignSends.campaignId, id));
  assert.ok(queued.length >= PEOPLE);
  const expected = queued.length;

  // Three senders at once, as if Send was pressed in three tabs.
  const results = await Promise.all([sendCampaign(id), sendCampaign(id), sendCampaign(id)]);
  // One more pass picks up anything a sender left for the others.
  results.push(await sendCampaign(id));

  const sent = ((await (await fetch(`${process.env.RESEND_API_URL}/__emails`)).json()) as { subject: string; to: string[] }[])
    .filter((email) => email.subject === subject)
    .map((email) => email.to[0]);
  assert.equal(sent.length, expected, "every person got it");
  assert.equal(new Set(sent).size, expected, "nobody got it twice");
  const rows = await db.select().from(campaignSends).where(eq(campaignSends.campaignId, id));
  assert.ok(rows.every((row) => row.status === "SENT"));
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  assert.equal(campaign.status, "SENT");
  console.log(`  ok  three senders at once: ${expected} people each got it exactly once`);

  assert.equal(await saveCampaign(db, "test", id, { ...content, body: "Changed." }), false);
  const [after] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  assert.equal(after.body, "Hello.");
  console.log("  ok  a campaign that has gone out can't be changed");

  // Sending it again does nothing.
  await sendCampaign(id);
  const again = ((await (await fetch(`${process.env.RESEND_API_URL}/__emails`)).json()) as { subject: string }[]).filter(
    (email) => email.subject === subject,
  );
  assert.equal(again.length, expected);
  console.log("  ok  sending a finished campaign again sends nothing");

  console.log("\n4 checks passed");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
