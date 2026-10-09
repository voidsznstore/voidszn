import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { ChangePasswordForm } from "@/components/admin/auth-forms";
import { SecurityCodeForm } from "@/components/admin/two-step-forms";
import { MIN_PASSWORD_LENGTH } from "@/lib/admin/passwords";
import { requireAdmin } from "@/lib/admin/session";
import { countRecoveryCodes } from "@/lib/admin/two-step";

export const metadata: Metadata = { title: "Security" };

type Props = PageProps<"/admin/security">;

export default function SecurityPage({ searchParams }: Props) {
  return (
    <>
      <PageHeader title="Security" />
      <Suspense fallback={<Loading />}>
        <Security searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const panel = "flex flex-col gap-4 panel p-5";

async function Security({ searchParams }: Pick<Props, "searchParams">) {
  const admin = await requireAdmin();
  const [{ recovery }, codesLeft] = await Promise.all([searchParams, countRecoveryCodes(admin.id)]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {recovery ? (
        <p className="notice px-4 py-3 text-sm">
          You signed in with a recovery code. That code is now used up. If your phone is gone
          for good, set up the authenticator app on your new one below.
        </p>
      ) : null}

      <section className={panel}>
        <h2 className="text-lg font-semibold text-white">Two-step sign-in</h2>
        <p className="text-bone-dim">
          On. Signing in as {admin.email} needs your password and a code from your authenticator
          app.
        </p>
      </section>

      <section className={panel}>
        <h2 className="text-lg font-semibold text-white">Password</h2>
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm link">
            Change your password
          </summary>
          <div className="pt-2">
            <ChangePasswordForm minLength={MIN_PASSWORD_LENGTH} />
          </div>
        </details>
      </section>

      <section className={panel}>
        <h2 className="text-lg font-semibold text-white">Recovery codes</h2>
        <p className="text-bone-dim">
          {codesLeft === 0
            ? "You have no recovery codes left. Make new ones now, so losing your phone can't lock you out."
            : `You have ${codesLeft} unused recovery ${codesLeft === 1 ? "code" : "codes"}. Each gets you in once if you don't have your phone.`}
        </p>
        <details open={codesLeft <= 2}>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm link">
            Make a new set of codes
          </summary>
          <div className="flex flex-col gap-3 pt-2">
            <p className="text-sm text-smoke">The old codes stop working as soon as you do.</p>
            <SecurityCodeForm kind="recovery-codes" />
          </div>
        </details>
      </section>

      <section className={panel}>
        <h2 className="text-lg font-semibold text-white">New phone or new app</h2>
        <p className="text-bone-dim">
          Moves two-step sign-in to a different authenticator app. The current one stops
          working, your recovery codes are replaced, and every other browser signed in to the
          admin is signed out.
        </p>
        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm link">
            Set up a different app or phone
          </summary>
          <div className="pt-2">
            <SecurityCodeForm kind="replace-app" />
          </div>
        </details>
      </section>
    </div>
  );
}
