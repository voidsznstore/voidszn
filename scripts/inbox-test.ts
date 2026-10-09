/**
 * Checks the Gmail inbox code against a stand-in mail server.
 * Run: GMAIL_APP_PASSWORD=... GMAIL_IMAP=plain:127.0.0.1:4143 GMAIL_SMTP=plain:127.0.0.1:4025 npm run test:inbox
 */
import assert from "node:assert/strict";
import {
  MailError,
  PAGE_SIZE,
  checkInbox,
  getAttachment,
  getMessage,
  listMessages,
  markUnread,
  sendMail,
} from "../src/lib/mail/gmail";

let passed = 0;
const ok = (label: string) => {
  passed++;
  console.log("  ok ", label);
};

async function main() {
  assert.equal(await checkInbox(), "ok");
  ok("signs in");

  const first = await listMessages("inbox");
  assert.equal(first.total, 34);
  assert.equal(first.pages, 2);
  assert.equal(first.messages.length, PAGE_SIZE);
  assert.deepEqual(
    first.messages.slice(0, 3).map((message) => message.subject),
    ["Logo for the custom hoodie", "HTML <b>only</b> & sneaky", "Where is my order?"],
  );
  const [logo, , order] = first.messages;
  assert.deepEqual(logo.from, { name: "Dana Reyes", address: "dana.reyes@example.com" });
  assert.equal(logo.unread, true);
  assert.equal(logo.hasAttachment, true);
  assert.equal(order.hasAttachment, false);
  assert.equal(first.messages[4].unread, false);
  ok("lists the newest page first, with sender, unread and attachment marks");

  const second = await listMessages("inbox", { page: 2 });
  assert.equal(second.messages.length, 34 - PAGE_SIZE);
  assert.equal(second.messages.at(-1)?.subject, "Filler 30");
  assert.equal((await listMessages("inbox", { page: 99 })).page, 2);
  ok("pages back through older mail");

  const found = await listMessages("inbox", { q: "buyer@example.com" });
  assert.equal(found.total, 1);
  assert.equal(found.messages[0].subject, "Where is my order?");
  assert.equal((await listMessages("inbox", { q: "subject:hoodie" })).total, 1);
  assert.equal((await listMessages("inbox", { q: "nothing-matches-this" })).total, 0);
  ok("searches like Gmail's search box");

  const opened = await getMessage("inbox", logo.uid);
  assert.ok(opened);
  assert.equal(opened.text.trim(), "Here is the logo. Black hoodie, size L please.");
  assert.deepEqual(opened.replyTo, { name: "Dana Work", address: "dana@work.example" });
  assert.equal(opened.messageId, "<m4@example.com>");
  assert.deepEqual(
    opened.attachments.map(({ name, type }) => ({ name, type })),
    [
      { name: "logo.png", type: "image/png" },
      { name: "evil.html", type: "text/html" },
    ],
  );
  const file = await getAttachment("inbox", logo.uid, 0);
  assert.equal(file?.name, "logo.png");
  assert.equal(file?.content.subarray(1, 4).toString(), "PNG");
  assert.equal(await getAttachment("inbox", logo.uid, 7), null);
  assert.equal(await getMessage("inbox", 99_999), null);
  ok("opens a message with its attachments");

  assert.equal((await listMessages("inbox")).messages[0].unread, false);
  await markUnread("inbox", logo.uid);
  assert.equal((await listMessages("inbox")).messages[0].unread, true);
  ok("opening marks as read, and it can be marked unread again");

  const html = await getMessage("inbox", first.messages[1].uid);
  assert.ok(html?.html?.includes("<script>"));
  ok("keeps the HTML as sent, for the page to lock down");

  const sentBefore = (await listMessages("sent")).total;
  await sendMail({
    to: opened.replyTo.address,
    subject: `Re: ${opened.subject}`,
    text: "Got it, thanks!",
    inReplyTo: { box: "inbox", uid: logo.uid, messageId: opened.messageId, references: opened.references },
  });
  const outbox = (await (await fetch("http://127.0.0.1:4026/__sent")).json()) as {
    from: string;
    to: string[];
    raw: string;
  }[];
  const last = outbox.at(-1);
  assert.ok(last);
  assert.equal(last.from, "voidsznstore@gmail.com");
  assert.deepEqual(last.to, ["dana@work.example"]);
  assert.match(last.raw, /^From: "?VOIDSZN"? <voidsznstore@gmail\.com>/m);
  assert.match(last.raw, /^In-Reply-To: <m4@example\.com>/m);
  assert.match(last.raw, /^References: <m4@example\.com>/m);
  assert.match(last.raw, /Got it, thanks!/);
  const sent = await listMessages("sent");
  assert.equal(sent.total, sentBefore + 1);
  assert.equal(sent.messages[0].subject, "Re: Logo for the custom hoodie");
  assert.equal(sent.messages[0].to[0].address, "dana@work.example");
  assert.equal((await listMessages("inbox")).messages[0].answered, true);
  ok("replies go out as the store's Gmail address, in the same conversation, and land in Sent");

  await assert.rejects(
    sendMail({ to: "someone@nowhere.invalid", subject: "x", text: "y" }),
    (error) => error instanceof MailError && /wouldn't send to that address/.test(error.message),
  );
  ok("a refused address is reported plainly");

  process.env.GMAIL_APP_PASSWORD = "wrong-password";
  assert.equal(await checkInbox(), "error: Gmail refused the sign-in");
  await assert.rejects(listMessages("inbox"), (error) => error instanceof MailError && /app password/.test(error.message));
  await assert.rejects(sendMail({ to: "a@example.com", subject: "x", text: "y" }), (error) => error instanceof MailError && /app password/.test(error.message));
  ok("a wrong app password is explained, for reading and for sending");

  process.env.GMAIL_IMAP = "plain:127.0.0.1:4999";
  assert.equal(await checkInbox(), "error: could not reach Gmail");
  ok("Gmail being unreachable is reported, not a crash");

  delete process.env.GMAIL_APP_PASSWORD;
  assert.equal(await checkInbox(), "not configured");
  console.log(`\n${passed} checks passed`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
