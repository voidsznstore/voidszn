# Launch checklist: legal and compliance

Written for a US store shipping to US addresses. This is a working checklist, not legal
advice. Have a lawyer read the policy pages before the store takes real orders.

## Before the first real order

- [ ] Replace the four sample products with real ones in the admin (or delete them).
- [ ] Every product on sale has real photos, a description, details and the right
      product type.

- [x] Fill every `[PLACEHOLDER]` in `src/lib/site-config.ts` (legal name, mailing address,
      support email, legal email, governing state). Done October 9, 2026: the business
      trades as VOIDSZN under Florida law. If an LLC is formed, put its registered name
      in `legalName`.
- [ ] Register the name. A person or partnership trading as "VOIDSZN" rather than under
      their own names registers it as a fictitious name with the Florida Division of
      Corporations (sunbiz.org): $50, lasts five years, and the name has to be advertised
      once in a local newspaper first. Forming an LLC called VOIDSZN does the same job.
- [ ] Confirm the policy terms in `site-config.ts` with the print supplier in writing:
      production time, shipping time, cancel window, 30-day issue window. The store must
      not promise more than the supplier backs.
- [ ] Business registration and a business bank account.
- [ ] Sales tax: register with the Florida Department of Revenue (Form DR-1, online)
      before the first real sale. Checkout already charges Florida sales tax on orders
      delivered in Florida. Watch for other states' thresholds as sales grow.
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
      Campaigns in the admin add the address and unsubscribe link by themselves and
      won't send until `mailingAddress` in `site-config.ts` is filled in. Only tick
      "Agreed to get marketing emails" for people who actually said yes.
- [ ] Cart reminders: these go to anyone who typed their email at checkout and left,
      whether or not they ticked the marketing box, and checkout says so next to the
      email field. They count as marketing email, so they carry the address and an
      unsubscribe link. Keep that sentence at checkout and the matching lines in the
      Privacy page for as long as reminders are switched on (Campaigns, Automatic
      emails). Have the lawyer confirm this is fine for every state you ship to.
- [ ] Pop-ups: the email sign-up says in plain words that signing up means marketing
      emails, with a link to the Privacy page. Keep that line. The code it promises must
      be the code it gives, and a countdown or "ends today" on a pop-up must be true.
- [ ] Discounts: a "sale" price or code must be a real saving, and an end date in an
      email must be the code's real end date.
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
- [ ] Sales tax: have the Florida certificate (Form DR-1) before the live token goes
      in. Checkout charges Florida sales tax on orders delivered in Florida, worked out
      from the address it asks for, and `/api/health` shows `"salesTax":"on"`. A
      business may not collect tax it isn't registered for, so if the certificate isn't
      there yet, switch "Charge sales tax at checkout" off on the Accounting screen
      (the tax is still owed, out of the price). Never charge tax for a state the
      business is not registered in. See `docs/tax-notes.md`.
- [ ] Open one live payment page for a Florida address and check the "Florida sales
      tax" line and the total match the checkout page, and that Square asks for no
      second address.
- [ ] Set the business name, logo and colors in Square (Account & Settings), which is
      what the payment page and receipts show.
- [ ] Email: `RESEND_API_KEY` set in Vercel and voidszn.com verified in Resend.
      `/api/health` shows `"email":"ok"` when both are done. Until then no order,
      shipping or refund emails go out and "Forgot your password?" does not work.
- [ ] Place one real order and refund it from the admin. Check the three emails arrive.
