import { siteConfig } from "@/lib/site-config";

/** Shown in place of the inbox until it has been connected to Gmail. */
export function InboxSetup() {
  return (
    <section className="flex max-w-2xl flex-col gap-4 border border-line bg-ash-soft p-5">
      <h2 className="text-lg font-semibold text-white">Connect your Gmail</h2>
      <p className="text-bone-dim">
        The inbox reads and sends as {siteConfig.inboxEmail}. It connects with an app password: a
        separate 16-letter password Google makes for one app, so your real password is never
        used here.
      </p>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-bone-dim">
        <li>
          Signed in to Google as {siteConfig.inboxEmail}, open{" "}
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            myaccount.google.com/apppasswords
          </a>
          . If Google says app passwords aren&apos;t available, turn on 2-Step Verification
          first.
        </li>
        <li>Name it &quot;VOIDSZN admin&quot; and press Create. Copy the 16 letters it shows.</li>
        <li>
          In Vercel, add an environment variable named{" "}
          <code className="font-mono text-bone">GMAIL_APP_PASSWORD</code> with those letters as
          the value, then redeploy.
        </li>
      </ol>
      <p className="text-[0.8125rem] text-smoke">
        To disconnect later, delete the app password in your Google account. That cuts off
        this inbox without changing anything else.
      </p>
    </section>
  );
}
