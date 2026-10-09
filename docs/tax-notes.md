# Tax notes

What the Accounting and Payouts screens assume about tax, and where each figure comes
from. The code is `src/lib/accounting/tax.ts`. Everything here was checked against its
source on October 9, 2026, for tax year 2026.

This is arithmetic to plan with, not tax advice. It assumes the business is taxed as a
partnership (the default for a business with several owners, including a multi-member
LLC that has made no election). Have an accountant confirm it before filing anything.

## Check once a year

- **County surtax rates** change on January 1. Florida publishes the new list each
  November as Form DR-15DSS. Update `FL_SURTAX_BPS`. Brevard's surtax is due to expire
  on December 31, 2026.
- **Federal figures** (`FEDERAL` in the same file): the Social Security wage base and
  the income tax brackets change each year.
- **ZIP codes to counties** (`fl-zip-counties.ts`) is from GeoNames (geonames.org,
  CC BY 4.0). A ZIP that crosses a county line is listed under one county, and a new ZIP
  will be missing. An order whose ZIP isn't found is taxed at 6% plus 1% and marked as
  an estimate.

## Florida sales tax

| Rule | Source |
| --- | --- |
| The state rate is 6%. Clothing is taxable. | [Florida DOR: sales and use tax](https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx) |
| A county surtax is added, at the rate of the county the order is **delivered to**. Orange County is 0.5%, so 6.5% at home. | [Form DR-15DSS for 2026](https://floridarevenue.com/Forms_library/current/dr15dss_26.pdf), [s. 212.054, F.S.](https://www.flsenate.gov/Laws/Statutes/2026/212.054) |
| The surtax applies only to the first $5,000 of one item. Not relevant at these prices, so the code doesn't apply the cap. | s. 212.054(2)(b)1., F.S. |
| Shipping is taxable when the customer can't avoid it, even on its own line. The store only ships, so shipping is taxed. | [Rule 12A-1.045, F.A.C.](https://law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-12A-1-045) |
| Tax is on the price after a discount the store gave. | [s. 212.02(16), F.S.](https://www.flsenate.gov/Laws/Statutes/2026/212.02) |
| A seller who doesn't charge the tax still owes it. | [s. 212.07(2), F.S.](https://www.flsenate.gov/Laws/Statutes/2026/212.07) |
| Rounded to the cent, halves up. | [Form DR-15N](https://floridarevenue.com/Forms_library/current/dr15n.pdf) |
| Clothing at $100 or less an item is tax-free from July 20 to August 20 every year, from 2026. An online order counts if it was placed in those dates. | [TIP 26A01-11](https://floridarevenue.com/taxes/tips/Documents/TIP_26A01-11.pdf) |
| A business in Florida registers (Form DR-1) and collects from its first Florida sale. There is no small-seller threshold for an in-state seller. | [Florida DOR: registration](https://floridarevenue.com/taxes/eservices/Pages/registration.aspx) |
| Returns are due on the 1st of the month after the period and late after the 20th. Filing is monthly above $1,000 of tax a year, quarterly up to $1,000, twice a year up to $500, yearly up to $100. | [s. 212.11, F.S.](https://www.flsenate.gov/Laws/Statutes/2026/212.11), Form DR-15N |
| Filing and paying online on time keeps 2.5% of the first $1,200 of tax, up to $30 a return. A late return costs 10%, at least $50. | Form DR-15N |

**Not checked against a source:** that orders delivered outside Florida owe Florida
nothing. That is the usual rule and the code follows it.

**Other states.** A seller with no presence in a state doesn't have to collect that
state's tax until it passes that state's threshold, which is $100,000 of sales a year
in most states (California, Texas and New York $500,000; Alabama and Mississippi
$250,000; some states also count 200 orders).
[Sales Tax Institute chart](https://www.salestaxinstitute.com/resources/economic-nexus-state-guide).
The books don't track this yet.

**What the store does today.** Checkout charges no sales tax. So on every order
delivered in Florida, the books take the tax out of what the customer paid and show it
as owed. Once checkout charges tax, the amount collected is used instead.

## Income tax

| Rule | Source |
| --- | --- |
| Florida has no personal income tax. | [Florida DOR](https://floridarevenue.com/faq/Pages/FAQDetails.aspx?FAQID=1466) |
| A partnership pays no Florida corporate income tax. Form F-1065 is only needed if a partner is a corporation. | [Form F-1065](https://floridarevenue.com/Forms_library/current/f1065.pdf) |
| A business with two or more owners is taxed as a partnership unless it elects otherwise. It files Form 1065 by March 15 and gives each partner a Schedule K-1. | [IRS: LLCs](https://www.irs.gov/businesses/small-businesses-self-employed/limited-liability-company-llc), [Form 1065 instructions](https://www.irs.gov/instructions/i1065) |
| Each partner is taxed on their share of the profit whether or not it was paid out. | [Schedule K-1 instructions](https://www.irs.gov/instructions/i1065sk1) |
| Self-employment tax is 15.3% (12.4% Social Security, 2.9% Medicare) of 92.35% of the share. Nothing is due under $400 of earnings. Half of it is deducted before income tax. | [IRS Topic 554](https://www.irs.gov/taxtopics/tc554), [2026 Form 1040-ES](https://www.irs.gov/pub/irs-pdf/f1040es.pdf) |
| The 12.4% stops at $184,500 of wages and self-employment earnings combined (2026). | [SSA](https://www.ssa.gov/oact/cola/cbb.html) |
| The business income deduction takes up to 20% off the profit before income tax. It is now permanent. | [IRS: QBI deduction](https://www.irs.gov/newsroom/qualified-business-income-deduction) |
| 2026 income tax rates: 10, 12, 22, 24, 32, 35 and 37%. | [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf) |
| Estimated tax is due April 15, June 15, September 15 and January 15, for anyone who will owe $1,000 or more. | 2026 Form 1040-ES |

The set-aside each partner sees is: self-employment tax on their share for the year,
plus income tax on the share (less half the self-employment tax, less 20%) at the rate
they picked. It can't see a partner's other income. A partner whose day job already
uses up the Social Security wage base owes less than shown; one with a higher bracket
than they picked owes more.

If the business elects to be taxed as an S or C corporation, none of the income tax
arithmetic above applies.

## Each year

- Florida LLC annual report: due May 1, $138.75, or $538.75 late.
  [Florida Division of Corporations](https://dos.fl.gov/sunbiz/forms/fees/llc-fees/)
- City of Orlando and Orange County business tax receipts renew by September 30.
  [City of Orlando](https://www.orlando.gov/btr), [Orange County Tax Collector](https://www.octaxcol.com/taxes/business-tax/)
- Square sends a Form 1099-K once a year's sales pass $20,000 and 200 payments. All
  income is reportable either way.
  [Square](https://squareup.com/help/us/en/article/5048-1099-k-overview)

## Card fees

Square charges 2.9% + 30¢ for payments taken through its online API
([Square developer pricing](https://developer.squareup.com/docs/payments-pricing)). The
books use that until Square reports the real fee on the payment (`processing_fee`),
which the timed job picks up a few minutes later.
