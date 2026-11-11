import { cookies } from "next/headers";
import { PORTAL_COOKIE } from "@/lib/portal";
import { createAnonClient } from "@/lib/supabase/anon";
import { renderInvoicePdf, pdfResponse, type InvoiceDocument } from "@/lib/pdf/invoice-pdf";

export const dynamic = "force-dynamic";

/** Member download — the database checks the invoice belongs to the session's member. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!session) return new Response("Please open your portal link again.", { status: 401 });
  const { id } = await params;
  const { data, error } = await createAnonClient().rpc("portal_invoice", { p_session: session, p_invoice_id: id });
  if (error || !data) return new Response("Not found", { status: 404 });
  const doc = data as InvoiceDocument;
  return pdfResponse(await renderInvoicePdf(doc), `${doc.invoice.invoice_number}.pdf`, false);
}
