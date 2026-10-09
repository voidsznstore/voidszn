import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageHeader } from "@/components/admin/page-header";
import { AccessButton, InviteForm, ResendInviteButton } from "@/components/admin/team-forms";
import { getDb } from "@/db";
import { type TeamMember, listTeam } from "@/db/queries/team";
import { formatDate } from "@/lib/admin/format";
import { isMaster, requireAdmin } from "@/lib/admin/session";
import { isEmailConfigured } from "@/lib/email/send";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <>
      <PageHeader title="Team" />
      <Suspense fallback={<Loading />}>
        <Team />
      </Suspense>
    </>
  );
}

function status(member: TeamMember): { label: string; tone: string; detail?: string } {
  if (member.disabled) return { label: "Access removed", tone: "tag-mute" };
  if (!member.joined) {
    if (!member.invite?.sentAt) return { label: "Invitation waiting to send", tone: "tag-warn" };
    return member.invite.expired
      ? { label: "Invitation expired", tone: "tag-warn", detail: `Sent ${formatDate(member.invite.sentAt)}` }
      : { label: "Invited", tone: "tag-accent", detail: `Sent ${formatDate(member.invite.sentAt)}` };
  }
  if (!member.twoStep) return { label: "Setting up", tone: "tag-warn", detail: "Authenticator app not set up yet" };
  return { label: "Active", tone: "tag-good" };
}

async function Team() {
  const admin = await requireAdmin();
  const team = await listTeam(getDb());
  const master = isMaster(admin);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-bone-dim">
        Everyone here works in the same dashboard: the same orders, customers, inbox, campaigns and
        books. A change one person makes shows for everyone. The master account is the only one
        that can add or remove people and change how payouts are worked out.
      </p>

      <ul className="flex flex-col gap-3">
        {team.map((member) => {
          const state = status(member);
          return (
            <li key={member.id} className="panel flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-white">
                    {member.name}
                    {member.id === admin.id ? <span className="font-normal text-smoke"> (you)</span> : null}
                  </h2>
                  <p className="break-all text-sm text-bone-dim">{member.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {member.isMaster ? <span className="tag">Master</span> : null}
                  <span className={`tag ${state.tone}`}>{state.label}</span>
                </div>
              </div>
              {state.detail ? <p className="text-sm text-smoke">{state.detail}</p> : null}
              {master && !member.isMaster ? (
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                  {!member.joined && !member.disabled ? <ResendInviteButton id={member.id} /> : null}
                  <AccessButton id={member.id} name={member.name} allowed={!member.disabled} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {master ? (
        <section className="panel flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Add someone</h2>
            <p className="text-sm text-smoke">
              They get an email with a link to set their name and password. The link works once, for
              a week. Set their share of the profit on the Payouts screen.
            </p>
          </div>
          {isEmailConfigured() ? (
            <InviteForm />
          ) : (
            <p className="notice px-4 py-3 text-sm">Email isn&apos;t set up yet, so invitations can&apos;t be sent.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
