"use client";

import Link from "next/link";
import { useRef } from "react";
import type { NavLink } from "@/lib/navigation";

type MenuGroup = { title: string; links: NavLink[] };

/** The phone menu: a button in the header that opens a sheet of glass with every section. */
export function SiteMenu({ groups }: { groups: MenuGroup[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label="Open menu"
        className="inline-flex h-11 items-center gap-2.5 rounded-full px-3.5 text-sm font-semibold text-bone transition-colors hover:bg-white/[0.07] hover:text-white md:hidden"
      >
        <span aria-hidden="true" className="flex w-4 flex-col gap-[5px]">
          <span className="h-px w-full bg-current" />
          <span className="h-px w-2.5 bg-current" />
        </span>
        Menu
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Menu"
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        className="glass glass-deep my-3 ml-auto mr-3 h-[calc(100dvh-1.5rem)] max-h-none w-[min(22rem,calc(100vw-1.5rem))] rounded-[1.75rem] p-0 text-bone backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 flex-none items-center justify-between pl-6 pr-3">
            <span className="display text-2xl text-white">Menu</span>
            <button type="button" onClick={close} className="btn btn-glass btn-sm">
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
            {groups
              .filter((group) => group.links.length > 0)
              .map((group) => (
                <nav key={group.title} aria-label={group.title} className="border-t border-line py-5">
                  <h2 className="label mb-1 text-smoke">{group.title}</h2>
                  <ul>
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          onClick={close}
                          className="flex min-h-11 items-center text-lg font-semibold hover:text-white"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
