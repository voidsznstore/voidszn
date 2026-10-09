"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { createOrderAction } from "@/app/admin/(panel)/orders/actions";
import type { OrderProductOption } from "@/db/queries/admin-manual-orders";
import { formatMoney } from "@/lib/money";

type Props = {
  products: OrderProductOption[];
  paymentMethods: string[];
  /** Whether the store can send email. Without it there is no confirmation to offer. */
  canEmail: boolean;
};

type Row = {
  key: string;
  /** "" for a custom item, otherwise a product from the catalog. */
  productId: string;
  colorId: string;
  variantId: string;
  name: string;
  details: string;
  size: string;
  price: string;
  quantity: string;
};

let counter = 0;
const blankRow = (): Row => ({
  key: `row${++counter}`,
  productId: "",
  colorId: "",
  variantId: "",
  name: "",
  details: "",
  size: "",
  price: "",
  quantity: "1",
});

const toDollars = (cents: number) => (cents / 100).toFixed(2);

/** "32", "32.5" and "$32.50" all mean 3250 cents. Returns null for anything else. */
function toCents(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Adding an order starts clean every time the page is opened, not where it was left. */
export function ManualOrderForm(props: Props) {
  const { bfcacheId } = useRouter();
  return <OrderEditor key={bfcacheId} {...props} />;
}

function OrderEditor({ products, paymentMethods, canEmail }: Props) {
  const router = useRouter();
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Made on the first save and kept, so saving the same form twice makes one order.
  const token = useRef<string | null>(null);

  const [email, setEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [delivery, setDelivery] = useState<"ship" | "pickup">("ship");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blankRow()]);
  const [shipping, setShipping] = useState("");
  const [discount, setDiscount] = useState("");
  const [payment, setPayment] = useState<"paid" | "unpaid">("paid");
  const [method, setMethod] = useState("");
  const [notify, setNotify] = useState(canEmail);
  const [note, setNote] = useState("");

  const update = (key: string, change: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  /** Picking a product, color or size fills in the price it sells for. It can still be changed. */
  function choose(row: Row, change: { productId?: string; colorId?: string; variantId?: string }) {
    const productId = change.productId ?? row.productId;
    const product = products.find((item) => item.id === productId);
    if (!product) {
      return update(row.key, { productId: "", colorId: "", variantId: "", price: "" });
    }
    const sameProduct = productId === row.productId;
    const colorId =
      change.colorId ?? (sameProduct && row.colorId ? row.colorId : (product.colors[0]?.id ?? ""));
    const sizes = product.variants.filter((variant) => variant.colorId === colorId);
    const currentSize = product.variants.find((variant) => variant.id === row.variantId)?.size;
    const variant =
      sizes.find((item) => item.id === change.variantId) ??
      // Keep the size when only the color changes.
      sizes.find((item) => sameProduct && item.size === currentSize) ??
      sizes[0];
    update(row.key, {
      productId,
      colorId,
      variantId: variant?.id ?? "",
      price: variant ? toDollars(variant.priceCents) : "",
    });
  }

  const subtotalCents = rows.reduce((sum, row) => {
    const cents = toCents(row.price) ?? 0;
    const quantity = /^\d{1,3}$/.test(row.quantity.trim()) ? Number(row.quantity) : 0;
    return sum + cents * quantity;
  }, 0);
  const shippingCents = delivery === "pickup" ? 0 : (toCents(shipping) ?? 0);
  const discountCents = toCents(discount) ?? 0;
  const totalCents = subtotalCents + shippingCents - discountCents;

  function handleSave() {
    const items = [];
    for (const [index, row] of rows.entries()) {
      const label = `item ${index + 1}`;
      const unitPriceCents = toCents(row.price);
      if (unitPriceCents === null) {
        return setError(`Enter the price for ${label} as a number, like 32 or 32.50.`);
      }
      if (!/^\d{1,3}$/.test(row.quantity.trim()) || Number(row.quantity) < 1) {
        return setError(`Enter how many of ${label}, as a whole number.`);
      }
      const quantity = Number(row.quantity);
      if (row.productId) {
        if (!row.variantId) return setError(`Pick a color and size for ${label}.`);
        items.push({ variantId: row.variantId, quantity, unitPriceCents });
      } else {
        if (!row.name.trim()) return setError(`Give ${label} a name.`);
        items.push({ name: row.name, details: row.details, size: row.size, quantity, unitPriceCents });
      }
    }

    const shippingValue = delivery === "pickup" || shipping.trim() === "" ? 0 : toCents(shipping);
    if (shippingValue === null) return setError("Enter the shipping charge as a number, or leave it empty.");
    const discountValue = discount.trim() === "" ? 0 : toCents(discount);
    if (discountValue === null) return setError("Enter the discount as a number, or leave it empty.");
    if (discountValue > subtotalCents + shippingValue) {
      return setError("The discount is more than the order comes to.");
    }
    if (payment === "paid" && !method) return setError("Choose how it was paid.");

    token.current ??= crypto.randomUUID();
    const payload = {
      token: token.current,
      email,
      customerName,
      phone,
      shipTo: delivery === "ship" ? { line1, line2, city, state, postalCode } : null,
      items,
      shippingCents: shippingValue,
      discountCents: discountValue,
      paidWith: payment === "paid" ? method : null,
      note,
      notify: canEmail && notify,
    };

    setError(null);
    startTransition(async () => {
      const result = await createOrderAction(payload).catch(() => ({
        error: "Something went wrong. Check your connection and try again.",
      }));
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/admin/orders/${result.orderNumber}`);
    });
  }

  const panel = "flex flex-col gap-4 border border-line bg-ash-soft p-5";
  const heading = "text-lg font-semibold text-white";
  const small = "text-[0.8125rem] text-smoke";
  const labelClass = "text-sm font-semibold";

  /** A labelled text box. */
  const field = (
    name: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${name}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input"
        {...extra}
      />
    </div>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSave();
      }}
      className="flex flex-col gap-6 pb-10"
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Items */}
          <section className={panel}>
            <h2 className={heading}>Items</h2>
            <ul className="flex flex-col gap-4">
              {rows.map((row, index) => {
                const product = products.find((item) => item.id === row.productId);
                const sizes = product?.variants.filter((variant) => variant.colorId === row.colorId) ?? [];
                const rowId = `${id}-${row.key}`;
                return (
                  <li key={row.key} className="flex flex-col gap-3 border border-line p-4">
                    <div className="flex items-end gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <label htmlFor={`${rowId}-product`} className={labelClass}>
                          Item {index + 1}
                        </label>
                        <select
                          id={`${rowId}-product`}
                          value={row.productId}
                          onChange={(event) => choose(row, { productId: event.target.value })}
                          className="input"
                        >
                          <option value="">Custom item (type it in)</option>
                          {products.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                              {item.isActive ? "" : " (hidden from store)"}
                            </option>
                          ))}
                        </select>
                      </div>
                      {rows.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => setRows(rows.filter((item) => item.key !== row.key))}
                          className="inline-flex min-h-[2.875rem] items-center px-2 text-sm text-smoke underline underline-offset-4 hover:text-bone"
                        >
                          Remove<span className="sr-only"> item {index + 1}</span>
                        </button>
                      ) : null}
                    </div>

                    {product ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={`${rowId}-color`} className={labelClass}>
                            Color
                          </label>
                          <select
                            id={`${rowId}-color`}
                            value={row.colorId}
                            onChange={(event) => choose(row, { colorId: event.target.value })}
                            className="input"
                          >
                            {product.colors.map((color) => (
                              <option key={color.id} value={color.id}>
                                {color.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={`${rowId}-size`} className={labelClass}>
                            Size
                          </label>
                          <select
                            id={`${rowId}-size`}
                            value={row.variantId}
                            onChange={(event) => choose(row, { variantId: event.target.value })}
                            className="input"
                          >
                            {sizes.map((variant) => (
                              <option key={variant.id} value={variant.id}>
                                {variant.size}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor={`${rowId}-name`} className={labelClass}>
                            What is it
                          </label>
                          <input
                            id={`${rowId}-name`}
                            value={row.name}
                            onChange={(event) => update(row.key, { name: event.target.value })}
                            maxLength={120}
                            placeholder="Custom hoodie, client's logo on the back"
                            className="input"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor={`${rowId}-details`} className={labelClass}>
                              Color (optional)
                            </label>
                            <input
                              id={`${rowId}-details`}
                              value={row.details}
                              onChange={(event) => update(row.key, { details: event.target.value })}
                              maxLength={60}
                              className="input"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor={`${rowId}-size-text`} className={labelClass}>
                              Size (optional)
                            </label>
                            <input
                              id={`${rowId}-size-text`}
                              value={row.size}
                              onChange={(event) => update(row.key, { size: event.target.value })}
                              maxLength={20}
                              className="input"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${rowId}-price`} className={labelClass}>
                          Price each (USD)
                        </label>
                        <input
                          id={`${rowId}-price`}
                          value={row.price}
                          onChange={(event) => update(row.key, { price: event.target.value })}
                          inputMode="decimal"
                          placeholder="32.00"
                          className="input font-mono"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor={`${rowId}-quantity`} className={labelClass}>
                          How many
                        </label>
                        <input
                          id={`${rowId}-quantity`}
                          value={row.quantity}
                          onChange={(event) => update(row.key, { quantity: event.target.value })}
                          inputMode="numeric"
                          className="input font-mono"
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => setRows([...rows, blankRow()])}
              className="btn btn-outline min-h-11 self-start px-5"
            >
              Add another item
            </button>
          </section>

          {/* Charges */}
          <section className={panel}>
            <h2 className={heading}>Shipping charge and discount</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {delivery === "ship"
                ? field("shipping", "Shipping charge (USD)", shipping, setShipping, {
                    inputMode: "decimal",
                    placeholder: "0.00",
                    className: "input font-mono",
                  })
                : null}
              {field("discount", "Discount (USD)", discount, setDiscount, {
                inputMode: "decimal",
                placeholder: "0.00",
                className: "input font-mono",
              })}
            </div>
            <dl className="flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
              <div className="flex justify-between text-bone-dim">
                <dt>Subtotal</dt>
                <dd className="font-mono">{formatMoney(subtotalCents)}</dd>
              </div>
              {discountCents > 0 ? (
                <div className="flex justify-between text-bone-dim">
                  <dt>Discount</dt>
                  <dd className="font-mono">-{formatMoney(discountCents)}</dd>
                </div>
              ) : null}
              {delivery === "ship" ? (
                <div className="flex justify-between text-bone-dim">
                  <dt>Shipping</dt>
                  <dd className="font-mono">{formatMoney(shippingCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between pt-1 text-base font-semibold text-white">
                <dt>Total</dt>
                <dd className="font-mono" data-testid="order-total">
                  {formatMoney(Math.max(0, totalCents))}
                </dd>
              </div>
            </dl>
            <p className={small}>No sales tax is added.</p>
          </section>

          {/* Note */}
          <section className={panel}>
            <h2 className={heading}>Note</h2>
            <label htmlFor={`${id}-note`} className="sr-only">
              Note
            </label>
            <textarea
              id={`${id}-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Design details, where the order came from. Customers never see this."
              className="input"
            />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          {/* Customer */}
          <section className={panel}>
            <h2 className={heading}>Customer</h2>
            {field("name", "Name", customerName, setCustomerName, {
              required: true,
              maxLength: 120,
              autoComplete: "off",
            })}
            {field("email", "Email", email, setEmail, {
              type: "email",
              required: true,
              maxLength: 254,
              autoComplete: "off",
            })}
            {field("phone", "Phone (optional)", phone, setPhone, {
              type: "tel",
              maxLength: 40,
              autoComplete: "off",
            })}
          </section>

          {/* Delivery */}
          <section className={panel}>
            <h2 className={heading}>Delivery</h2>
            <fieldset className="flex flex-col">
              <legend className="sr-only">How the order gets to the customer</legend>
              {(
                [
                  ["ship", "Ship it"],
                  ["pickup", "Pickup or handed over"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name={`${id}-delivery`}
                    checked={delivery === value}
                    onChange={() => setDelivery(value)}
                    className="h-5 w-5 accent-[var(--color-accent)]"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            {delivery === "ship" ? (
              <>
                {field("line1", "Street address", line1, setLine1, { required: true, maxLength: 200, autoComplete: "off" })}
                {field("line2", "Apartment, suite (optional)", line2, setLine2, { maxLength: 200, autoComplete: "off" })}
                {field("city", "City", city, setCity, { required: true, maxLength: 100, autoComplete: "off" })}
                <div className="grid grid-cols-2 gap-3">
                  {field("state", "State", state, setState, { required: true, maxLength: 60, autoComplete: "off" })}
                  {field("zip", "ZIP code", postalCode, setPostalCode, { required: true, maxLength: 20, autoComplete: "off" })}
                </div>
              </>
            ) : null}
          </section>

          {/* Payment */}
          <section className={panel}>
            <h2 className={heading}>Payment</h2>
            <fieldset className="flex flex-col">
              <legend className="sr-only">Whether the customer has paid</legend>
              {(
                [
                  ["paid", "Already paid"],
                  ["unpaid", "Not paid yet"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name={`${id}-payment`}
                    checked={payment === value}
                    onChange={() => setPayment(value)}
                    className="h-5 w-5 accent-[var(--color-accent)]"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            {payment === "paid" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-method`} className={labelClass}>
                  Paid with
                </label>
                <select
                  id={`${id}-method`}
                  value={method}
                  onChange={(event) => {
                    setMethod(event.target.value);
                    setError(null);
                  }}
                  className="input"
                >
                  <option value="" disabled>
                    Choose
                  </option>
                  {paymentMethods.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <p className={small}>
                  This only records the payment. It doesn&apos;t charge anyone.
                </p>
              </div>
            ) : (
              <p className={small}>
                The order waits under &quot;Not paid&quot; until you mark it as paid.
              </p>
            )}
          </section>

          {canEmail ? (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={notify}
                onChange={(event) => setNotify(event.target.checked)}
                className="h-5 w-5 accent-[var(--color-accent)]"
              />
              <span>Email the customer an order confirmation</span>
            </label>
          ) : null}

          <div className="flex flex-col gap-3">
            <button type="submit" disabled={pending} className="btn btn-accent disabled:opacity-60">
              {pending ? "Adding…" : `Add order · ${formatMoney(Math.max(0, totalCents))}`}
            </button>
            <p role="alert" aria-live="polite" className="text-sm text-accent">
              {error ?? ""}
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}
