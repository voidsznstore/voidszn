# Launch checklist: legal and compliance

Written for a US store shipping to US addresses. This is a working checklist, not legal
advice. Have a lawyer read the policy pages before the store takes real orders.

## Before the first real order

- [ ] Fill every `[PLACEHOLDER]` in `src/lib/site-config.ts` (legal name, mailing address,
      support email, legal email, governing state). The policy pages show a "Draft" notice
      until this is done.
- [ ] Confirm the policy terms in `site-config.ts` with the print supplier in writing:
      production time, shipping time, cancel window, 30-day issue window. The store must
      not promise more than the supplier backs.
- [ ] Business registration and a business bank account.
- [ ] Sales tax: register with the state revenue department where the business is based
      and collect tax on orders shipped there (see the Payments section for what that
      needs in checkout), and watch for other states' thresholds as sales grow.
- [ ] Lawyer review of Privacy, Terms, Returns, Shipping and IP pages.

## Shipping promises (FTC Mail, Internet or Telephone Order Rule)

- [ ] Only state shipping times there is a reasonable basis for.
- [ ] If an order can't ship in the stated time, email the customer a new date and offer
      a full refund. Build this into the order admin (a "delayed" action that sends the email).

## Product designs (copyright, trademark, right of publicity)

- [ ] Every design is original, properly licensed, or cleared by a lawyer. Category names
      like Anime, Gaming, Film & TV and Music are fine as themes. Using characters, logos,
      titles, band names, lyrics or a real person's face or name without a license is not,
      and "parody" or "fan art" is not a safe default.
- [ ] Keep a record of where each design came from (who made it, license if any).
- [ ] Monitor the legal inbox and remove reported designs promptly.

## Marketing

- [ ] Email (CAN-SPAM): real "from" name, honest subject lines, the mailing address in
      every marketing email, a working unsubscribe honored within 10 business days.
- [ ] Texts (TCPA): only to people who gave written consent through an unchecked box or
      explicit sign-up, with message frequency, "Msg and data rates may apply", and
      STOP/HELP wording at the point of sign-up.
- [ ] Reviews (FTC): only real reviews from real buyers. No incentives tied to positive
      reviews, no hiding negative ones. "Verified buyer" only when tied to a paid order.
- [ ] Affiliates and creators (FTC Endorsement Guides): require them to disclose the
      relationship clearly in every post. Put this in the partner terms.
- [ ] Pricing: a "compare at" price must be a real former price.

## Privacy

- [ ] The Privacy page matches what the site actually does. Update it when a new tool
      is added.
- [ ] Before adding advertising pixels or analytics that track across sites: add a
      consent banner, honor the Global Privacy Control signal, and add a
      "Your Privacy Choices" link in the footer.
- [ ] Do not collect more than checkout needs. Never store card numbers.
- [ ] Have a plan for a data request (access, correction, deletion) and answer within 45 days.

## Accessibility

- [ ] Keyboard-only pass through browse, cart and checkout.
- [ ] Screen reader pass on the product page and checkout.
- [ ] Alt text on every product photo.

## Payments

- [ ] Follow the processor's rules for the product category.
- [ ] Refund and cancellation terms are visible before payment.
- [ ] Statement descriptor shows a name customers will recognize.

### Switching Square from sandbox to live

The site runs on the Sandbox access token until every item here is done.

- [ ] Square account fully activated (identity verified, bank account linked).
- [ ] In Vercel, replace `SQUARE_ACCESS_TOKEN` with the Production access token from the
      same Square application, then redeploy. Nothing else changes: the store detects
      live mode, finds the location and registers the live webhook by itself.
- [ ] Open `/api/health` and confirm it says `"payments":"production"` and
      `"webhook":"ok"`.
- [ ] Sales tax. Checkout charges no tax today. Square's payment page does not work
      tax out from the delivery address, so before collecting tax: register with the
      state, then have checkout ask for the address first and add the tax line to the
      order. Never charge tax for a state the business is not registered in.
- [ ] Set the business name, logo and colors in Square (Account & Settings), which is
      what the payment page and receipts show.
- [ ] Place one real order and refund it.
