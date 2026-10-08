import { EclipseLogo } from "@/components/brand/eclipse-logo";

// Placeholder until the storefront is built. It exists to prove the brand tokens,
// fonts and logo render correctly in a deployed build.
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="label flex min-h-9 items-center justify-center bg-accent px-4 py-1.5 text-center text-xs text-on-accent">
        SZN 01 is coming
      </div>

      <header className="flex items-center justify-center border-b border-line px-4 py-4">
        <EclipseLogo size={30} />
      </header>

      <section className="mx-auto flex w-full max-w-site flex-1 flex-col justify-center gap-6 px-4 py-20 sm:px-10">
        <p className="label text-accent">SZN 01</p>
        <h1 className="display max-w-4xl text-[clamp(3.5rem,11vw,9.25rem)] text-white">
          Nothing is in season
        </h1>
        <p className="max-w-xl text-lg text-bone-dim">
          Printed when you order. No logos on the clothes. The store opens soon.
        </p>
      </section>
    </main>
  );
}
