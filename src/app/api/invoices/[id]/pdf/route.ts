import { getStaffContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { renderInvoicePdf, pdfResponse, type InvoiceDocument } from "@/lib/pdf/invoice-pdf";

export const dynamic = "force-dynamic";

/**
 * Staff download. Invoices are immutable once issued, so the PDF is rendered
 * from the stored snapshot and is identical on every download.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getStaffContext())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_invoice_document", { p_invoice_id: id });
  if (error || !data) return new Response("Not found", { status: 404 });
  const doc = data as InvoiceDocument;
  const download = new URL(req.url).searchParams.has("download");
  return pdfResponse(await renderInvoicePdf(doc), `${doc.invoice.invoice_number}.pdf`, !download);
}
