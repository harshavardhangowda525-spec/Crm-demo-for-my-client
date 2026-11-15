import Link from "next/link";
import { ArrowLeft, Bot, MessagesSquare, UserRound } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { GlassCard, SectionTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { BotSettings } from "@/components/inbox/bot-settings";
import { ReplyBox } from "@/components/inbox/reply-box";
import { InboxLive } from "@/components/inbox/live";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

export const metadata = { title: "Inbox" };

type Conversation = {
  contact_phone_e164: string;
  customer_id: string | null;
  display_name: string | null;
  last_body: string;
  last_author: "member" | "bot" | "staff";
  last_at: string;
  unread: number;
  needs_staff: boolean;
};

type Message = {
  id: string;
  direction: "in" | "out";
  author: "member" | "bot" | "staff";
  body: string;
  status: "received" | "sent" | "failed";
  error: string | null;
  needs_staff: boolean;
  created_at: string;
};

const PREFIX = { member: "", bot: "Bot: ", staff: "You: " } as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: convs }, { data: gym }] = await Promise.all([
    supabase.rpc("inbox_conversations", { p_limit: 100 }),
    supabase.from("gyms").select("auto_reply_enabled, auto_reply_info").eq("id", staff.gymId).single(),
  ]);
  const conversations = (convs ?? []) as Conversation[];
  const selected = sp.c && /^\+[1-9][0-9]{6,14}$/.test(sp.c) ? sp.c : null;
  const current = conversations.find((c) => c.contact_phone_e164 === selected) ?? null;

  let messages: Message[] = [];
  let windowOpen = false;
  if (selected) {
    const [{ data: m }, { data: w }] = await Promise.all([
      supabase
        .from("whatsapp_inbox")
        .select("id, direction, author, body, status, error, needs_staff, created_at")
        .eq("gym_id", staff.gymId)
        .eq("contact_phone_e164", selected)
        .order("created_at", { ascending: true })
        .limit(300)
        .returns<Message[]>(),
      supabase.rpc("inbox_window", { p_phone: selected }),
    ]);
    messages = m ?? [];
    windowOpen = Boolean((w as { open?: boolean } | null)?.open);
  }

  const name = (c: Conversation) => c.display_name ?? formatPhone(c.contact_phone_e164);

  return (
    <div className="space-y-5">
      <InboxLive phone={selected} unread={current?.unread ?? 0} />
      <SectionTitle
        eyebrow="WhatsApp"
        title="Inbox"
        description="Messages members send to your WhatsApp number. The bot answers common questions instantly; chats marked “Needs staff” are waiting for you."
      />

      <BotSettings enabled={gym?.auto_reply_enabled ?? false} info={gym?.auto_reply_info ?? null} canEdit={can(staff.role, "automations.manage")} />

      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        {/* Conversation list */}
        <GlassCard className={cn("p-2", selected && "hidden md:block")}>
          {!conversations.length ? (
            <EmptyState
              icon={MessagesSquare}
              title="No messages yet"
              description="When a member messages your WhatsApp number, the chat appears here."
            />
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {conversations.map((c) => (
                <li key={c.contact_phone_e164}>
                  <Link
                    href={`/inbox?c=${encodeURIComponent(c.contact_phone_e164)}`}
                    className={cn(
                      "flex flex-col gap-1 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.03]",
                      c.contact_phone_e164 === selected && "bg-white/[0.05]",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate font-medium">{name(c)}</p>
                      {c.unread > 0 && <Badge tone="lime">{c.unread}</Badge>}
                    </div>
                    <p className="line-clamp-1 text-[13px] text-muted">
                      {PREFIX[c.last_author]}
                      {c.last_body}
                    </p>
                    <div className="flex items-center gap-2 text-[11.5px] text-subtle">
                      <span>{formatDateTime(c.last_at)}</span>
                      {c.needs_staff && <Badge tone="amber">Needs staff</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Thread */}
        <GlassCard className={cn("flex min-h-[420px] flex-col p-3 md:p-4", !selected && "hidden md:flex")}>
          {!selected ? (
            <EmptyState icon={MessagesSquare} title="Pick a conversation" description="Choose a chat on the left to read it and reply." className="m-auto" />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3">
                <Link href="/inbox" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-white/5 md:hidden" aria-label="Back to conversations">
                  <ArrowLeft className="size-4" />
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{current ? name(current) : formatPhone(selected)}</p>
                  <p className="text-xs text-subtle">{formatPhone(selected)}</p>
                </div>
                {current?.customer_id && (
                  <Link href={`/customers/${current.customer_id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-cyan hover:bg-white/5">
                    <UserRound className="size-3.5" /> Profile
                  </Link>
                )}
              </div>

              <ol className="flex-1 space-y-2.5 overflow-y-auto py-4">
                {messages.map((m) => (
                  <li key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                        m.direction === "in" && "rounded-tl-md bg-elevated",
                        m.author === "bot" && "rounded-tr-md bg-cyan/10 shadow-[inset_0_0_0_1px_rgb(88_217_255/0.18)]",
                        m.author === "staff" && "rounded-tr-md bg-lime/10 shadow-[inset_0_0_0_1px_rgb(198_255_69/0.2)]",
                      )}
                    >
                      {m.direction === "out" && (
                        <p className={cn("mb-1 flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider", m.author === "bot" ? "text-cyan" : "text-lime")}>
                          {m.author === "bot" ? (
                            <>
                              <Bot className="size-3" /> Bot
                            </>
                          ) : (
                            "Staff"
                          )}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className="mt-1 flex items-center justify-end gap-2 text-[10.5px] text-subtle">
                        {m.direction === "in" && m.needs_staff && <span className="text-warning">Needs staff</span>}
                        {m.status === "failed" && <span className="text-danger">Not sent{m.error ? ` — ${m.error}` : ""}</span>}
                        {formatDateTime(m.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="border-t border-white/[0.06] pt-3">
                <ReplyBox phone={selected} windowOpen={windowOpen} />
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
