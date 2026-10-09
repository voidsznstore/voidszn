"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type BannerFormState, saveBannerAction } from "@/app/admin/(panel)/banner/actions";
import { BannerStrip } from "@/components/site/banner";
import { BANNER_COLORS, BANNER_LIMITS, type Banner, isHexColor } from "@/lib/banner/shape";
import { useFormAction } from "./use-form-action";

const initial: BannerFormState = {};

/** Each visit to the page starts from what is saved, not from what was last typed. */
export function BannerForm({ banner }: { banner: Banner }) {
  const { bfcacheId } = useRouter();
  return <Editor key={bfcacheId} banner={banner} />;
}

function Editor({ banner }: { banner: Banner }) {
  const { state, action, pending, onSubmit } = useFormAction(saveBannerAction, initial);
  const [enabled, setEnabled] = useState(banner.enabled);
  const [text, setText] = useState(banner.messages.join("\n"));
  const [color, setColor] = useState(banner.color.toUpperCase());

  const messages = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const label = "text-sm font-semibold";
  const small = "text-[0.8125rem] text-smoke";

  return (
    <form action={action} onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-6">
      <section className="panel flex flex-col gap-3 overflow-hidden p-5">
        <h2 className="text-lg font-semibold text-white">How it looks</h2>
        <div className="-mx-5 -mb-5 bg-void">
          {messages.length > 0 ? (
            <BannerStrip banner={{ enabled: true, messages, color: isHexColor(color) ? color : "#EDEAE3" }} />
          ) : (
            <p className="px-5 py-3 text-sm text-smoke">Write a line below to see it move.</p>
          )}
        </div>
      </section>

      <section className="panel flex flex-col gap-5 p-5">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="text-lg font-semibold text-white">Show the banner</span>
            <span className={small}>It runs under the header on every page of the store.</span>
          </span>
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-bone ${
              enabled ? "border-white/25 bg-accent shadow-[0_0_16px_-4px_var(--glow)]" : "border-line-strong bg-white/[0.06]"
            }`}
          >
            <span className={`h-5 w-5 rounded-full bg-bone shadow transition-transform ${enabled ? "translate-x-[1.375rem]" : "translate-x-1"}`} />
          </span>
        </label>

        <div className="flex flex-col gap-1.5 border-t border-line pt-5">
          <label htmlFor="banner-messages" className={label}>
            What it says
          </label>
          <textarea
            id="banner-messages"
            name="messages"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby="banner-messages-hint"
            placeholder={"Nothing is in season\nFree shipping this weekend with code FREESHIP"}
            className="input"
          />
          <p id="banner-messages-hint" className={small}>
            One line each. Up to {BANNER_LIMITS.messages} lines, which scroll past one after another.
          </p>
        </div>

        <fieldset className="flex flex-col gap-3 border-t border-line pt-5">
          <legend className={`${label} float-left mb-3 w-full`}>Color of the words</legend>
          <div className="flex flex-wrap items-center gap-2">
            {BANNER_COLORS.map((option) => (
              <label key={option.hex} className={`chip cursor-pointer ${color === option.hex ? "is-on" : ""}`}>
                <input
                  type="radio"
                  name="swatch"
                  value={option.hex}
                  checked={color === option.hex}
                  onChange={() => setColor(option.hex)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.35)]"
                  style={{ background: option.hex }}
                />
                {option.name}
              </label>
            ))}
            <label className="chip cursor-pointer gap-2.5">
              <input
                type="color"
                value={isHexColor(color) ? color : "#EDEAE3"}
                onChange={(event) => setColor(event.target.value.toUpperCase())}
                aria-label="Pick any color"
                className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              Any color
            </label>
          </div>
          <input type="hidden" name="color" value={color} />
          <p className={small}>The banner sits on a dark strip, so light colors read best.</p>
        </fieldset>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-accent">
          {pending ? "Saving…" : "Save banner"}
        </button>
        <p role="alert" aria-live="polite" className={`text-sm ${state.error ? "text-ember" : "text-smoke"}`}>
          {state.error ?? (state.saved && !pending ? "Saved. It's on the store now." : "")}
        </p>
      </div>
    </form>
  );
}
