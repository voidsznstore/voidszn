# Card payouts: switching them on

Partners cash out to a debit card through Stripe. Customers still pay through Square;
Stripe is only used to pay partners. Until the steps below are done, the Payouts tab
says card payouts aren't switched on and cash-outs are sent by hand.

## How it works

1. A partner opens Payouts and presses **Add a debit card**. Stripe's own form checks
   who they are (name, date of birth, address, the last four of their SSN) and takes
   the card. The site never sees the card number.
2. When they cash out, the site moves the amount from the store's Stripe balance to
   their Stripe account, and from there to the card as an instant payout. It usually
   lands within 30 minutes, any day.
3. If it can't go through (the store's Stripe balance is short, their card isn't ready,
   Stripe refuses it), the cash-out waits on the master dashboard. Press **Send to
   card** once the cause is fixed, or send it by hand and mark it sent.

## One-time set-up (the owner, in Stripe)

1. **Activate the Stripe account** for the business and **turn on Connect**
   (Settings, Connect). Fill in the platform profile; Stripe has to approve it before
   partners can be added or funds added.
2. **Allow debit cards.** Settings, Connect, External accounts: set
   "Allow debit cards?" to Yes, and don't require a bank account first.
3. **Make a restricted key.** Developers, API keys, Create restricted key. It needs
   to write to Connect (accounts and account links), transfers, payouts and payout
   settings, and to read the balance. Nothing else. Stripe's names for these
   permissions change, so if a step is refused, the message on the Payouts tab says
   which permission is missing.
4. **Add it to Vercel** as `STRIPE_SECRET_KEY` (mark it Sensitive), then redeploy.
   `/api/health` then shows `cardPayouts: "on, live"` (or "on, test mode" with a
   test key).
5. **Add money to the Stripe balance.** Balance, Add to balance, Payments balance.
   The first time, Stripe verifies the bank account with two small deposits (1 to 2
   business days). After that a bank debit takes about 5 days and an ACH credit or
   wire sent from the bank 0 to 2 business days. The master dashboard shows the
   balance and how much everyone could cash out.
6. Optional: **a webhook**, so a bounced payout is caught at once. Developers,
   Webhooks, add an endpoint for `https://www.voidszn.com/api/webhooks/stripe`,
   listening on connected accounts for `payout.paid`, `payout.failed` and
   `payout.canceled`. Put its signing secret in Vercel as `STRIPE_WEBHOOK_SECRET`.
   Without it the half-hourly job does the same check.

## Trying it with a test key first

With a test-mode key in `STRIPE_SECRET_KEY`, `/api/health` shows
`cardPayouts: "on, test mode (practice only, no real money moves)"` and everything is
a practice run:

- A partner can add a card using one of the test debit cards on Stripe's testing
  page. It shows on their Payouts tab marked **Test mode**.
- A cash-out is run through Stripe's test mode to prove the steps work, then left
  waiting on the master dashboard with "Practice run only" beside it. It is never
  marked as sent, because no real money moved. Pay it by hand, or cancel it.
- After swapping in the live key, each partner adds their real card once. A practice
  card means nothing to the live key.

## What Stripe charges the business

From Stripe's Connect pricing for platforms that set their own pricing, checked
October 9, 2026 (stripe.com/connect/pricing):

- 1% of each instant payout
- 0.25% + 25¢ per payout
- $2 for each partner paid in a month

So a $100 cash-out costs about $1.50, plus $2 the first time that partner is paid in
a month. The Accounting screen counts these as a business cost, from the stand-in
figures at the bottom of that screen. Check them against Stripe's monthly bill.

One payout can be at most $9,999 and at least 50¢. Stripe also caps how much a
platform can pay out instantly per day.

## Limits worth knowing

- The card has to be a US debit card (Visa, Mastercard or Discover) that isn't
  prepaid.
- Money has to be in the Stripe balance before a cash-out, because sales land in
  Square. The alternative is moving checkout to Stripe so sales land there.
- A partner's Stripe account is kept on a manual payout schedule, so only a cash-out
  made here sends money to the card. Don't change that schedule in Stripe.
- If the store's Stripe key is ever swapped back to a test key, real cards already
  set up are left alone and simply can't be used until the live key is back.

## Not yet proven against Stripe itself

Every step was tested against a stand-in built from Stripe's documentation, because
the build machine can't reach Stripe. Run one practice cash-out with a test key, then
one small real one, before relying on it. Four things in particular are assumed from
the documentation and not confirmed:

1. Money added to the balance by a top-up can be paid out instantly straight away.
   Stripe may hold some of it as not yet instant-available.
2. An account set up only to receive money (the "recipient" kind used here) can be
   sent an instant payout and have its cards listed with the calls this site makes.
3. Right after a transfer or payout is made, Stripe's lists include it. The
   never-pay-twice checks lean on that; the 5-minute hold after an unclear failure is
   there in case they lag.
4. The exact wording Stripe uses when a transfer was already taken back.

If any of these is wrong the cash-out stays waiting with Stripe's own message beside
it, and can be sent by hand. The safeguards are built so that a wrong guess leaves
money unsent, not sent twice.

## Sources

- [Instant Payouts for Connect](https://docs.stripe.com/connect/instant-payouts)
- [Add funds to your platform balance](https://docs.stripe.com/connect/top-ups)
- [Accounts v2: create an account](https://docs.stripe.com/api/v2/core/accounts/create)
- [Manage payout accounts for connected accounts](https://docs.stripe.com/connect/payouts-bank-accounts)
- [Connect pricing](https://stripe.com/connect/pricing)
