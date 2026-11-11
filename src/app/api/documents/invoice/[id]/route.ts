import { type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { verifyDocumentSignature } from "@/lib/signing";
import { createAnonClient } from "@/lib/supabase/anon";
import { renderInvoicePdf, pdfResponse, type InvoiceDocument } from "@/lib/pdf/invoice-pdf";

export const dynamic = "force-dynamic";

/** Signed, expiring invoice link fetched by WhatsApp when attaching the PDF. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const secret = serverEnv().CRON_SECRET;
  const sp = req.nextUrl.searchParams;
  if (!secret || !/^[0-9a-f-]{36}$/.test(id) || !verifyDocumentSignature(secret, id, sp.get("exp"), sp.get("sig"))) {
    return new Response("Link expired or invalid", { status: 403 });
  }
  const { data, error } = await createAnonClient().rpc("document_invoice", { p_secret: secret, p_invoice_id: id });
  if (error || !data) return new Response("Not found", { status: 404 });
  const doc = data as InvoiceDocument;
  return pdfResponse(await renderInvoicePdf(doc), `${doc.invoice.invoice_number}.pdf`);
}
