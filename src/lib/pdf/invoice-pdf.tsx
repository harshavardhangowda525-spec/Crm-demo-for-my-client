import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatINR, PAYMENT_METHODS, PAYMENT_STATUS, label } from "@/lib/format";

export type InvoiceDocument = {
  invoice: {
    id: string;
    invoice_number: string;
    issue_date: string;
    status: "issued" | "cancelled";
    payment_status: "unpaid" | "partial" | "paid";
    subtotal_paise: number;
    discount_paise: number;
    taxable_paise: number;
    gst_rate: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    total_paise: number;
    amount_paid_paise: number;
    cancelled_reason: string | null;
    notes: string | null;
    customer_snapshot: { name: string; phone: string; email: string | null };
    gym_snapshot: {
      name: string;
      legal_name: string | null;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      state_code: string | null;
      postal_code: string | null;
      gstin: string | null;
      phone: string | null;
      email: string | null;
      sac_code: string;
      gst_enabled: boolean;
    };
  };
  items: { description: string; sac_code: string | null; quantity: number; unit_price_paise: number; amount_paise: number }[];
  membership: { plan_name: string; start_date: string; end_date: string } | null;
  payments: { amount_paise: number; method: string; paid_at: string; reference: string | null }[];
};

// PDF fonts: built-in Helvetica has no ₹ glyph, so amounts use "Rs." here.
const money = (p: number) => formatINR(p, { decimals: true }).replace("₹", "Rs. ");

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9.5, fontFamily: "Helvetica", color: "#111722" },
  band: { position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: "#C6FF45" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: -0.3 },
  muted: { color: "#5f6878" },
  h: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#5f6878", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", textAlign: "right" },
  box: { borderWidth: 1, borderColor: "#e3e7ee", borderRadius: 6, padding: 10 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#5f6878", textTransform: "uppercase", paddingVertical: 6 },
  td: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#eef1f5" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, marginTop: 4, borderTopWidth: 1.5, borderTopColor: "#111722" },
  stamp: { position: "absolute", top: 300, left: 120, fontSize: 64, color: "#ff5c7a", opacity: 0.18, transform: "rotate(-20deg)", fontFamily: "Helvetica-Bold" },
});

function InvoicePdf({ doc }: { doc: InvoiceDocument }) {
  const i = doc.invoice;
  const g = i.gym_snapshot;
  const c = i.customer_snapshot;
  const address = [g.address_line1, g.address_line2, [g.city, g.state, g.postal_code].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("\n");
  const halfRate = Number(i.gst_rate) / 2;
  const outstanding = i.total_paise - i.amount_paid_paise;

  return (
    <Document title={`Invoice ${i.invoice_number}`} author={g.legal_name || g.name}>
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed />
        {i.status === "cancelled" && <Text style={s.stamp}>CANCELLED</Text>}

        <View style={[s.between, { marginTop: 8 }]}>
          <View style={{ maxWidth: 280 }}>
            <Text style={s.brand}>{g.name}</Text>
            {g.legal_name && g.legal_name !== g.name && <Text style={s.muted}>{g.legal_name}</Text>}
            {address ? <Text style={[s.muted, { marginTop: 4, lineHeight: 1.4 }]}>{address}</Text> : null}
            {g.phone && <Text style={s.muted}>Phone: {g.phone}</Text>}
            {g.email && <Text style={s.muted}>{g.email}</Text>}
            {g.gstin && <Text style={{ marginTop: 4, fontFamily: "Helvetica-Bold" }}>GSTIN: {g.gstin}</Text>}
          </View>
          <View>
            <Text style={s.title}>{g.gst_enabled && g.gstin ? "TAX INVOICE" : "INVOICE"}</Text>
            <Text style={{ textAlign: "right", marginTop: 6 }}>No. {i.invoice_number}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Date: {formatDate(i.issue_date)}</Text>
            <Text style={[{ textAlign: "right", marginTop: 4, fontFamily: "Helvetica-Bold" }]}>
              {label(PAYMENT_STATUS, i.payment_status).toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 22, gap: 12 }]}>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.h}>Billed to</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{c.name}</Text>
            <Text style={s.muted}>{c.phone}</Text>
            {c.email && <Text style={s.muted}>{c.email}</Text>}
          </View>
          {doc.membership && (
            <View style={[s.box, { flex: 1 }]}>
              <Text style={s.h}>Membership</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{doc.membership.plan_name}</Text>
              <Text style={s.muted}>
                {formatDate(doc.membership.start_date)} – {formatDate(doc.membership.end_date)}
              </Text>
              {g.state_code && <Text style={s.muted}>Place of supply: {g.state ?? ""} ({g.state_code})</Text>}
            </View>
          )}
        </View>

        <View style={{ marginTop: 22 }}>
          <View style={s.row}>
            <Text style={[s.th, { flex: 1 }]}>Description</Text>
            <Text style={[s.th, { width: 60 }]}>SAC</Text>
            <Text style={[s.th, { width: 30, textAlign: "right" }]}>Qty</Text>
            <Text style={[s.th, { width: 90, textAlign: "right" }]}>Rate</Text>
            <Text style={[s.th, { width: 90, textAlign: "right" }]}>Amount</Text>
          </View>
          {doc.items.map((it, idx) => (
            <View key={idx} style={[s.row, s.td]}>
              <Text style={{ flex: 1, paddingRight: 8 }}>{it.description}</Text>
              <Text style={{ width: 60 }}>{it.sac_code ?? ""}</Text>
              <Text style={{ width: 30, textAlign: "right" }}>{it.quantity}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>{money(it.unit_price_paise)}</Text>
              <Text style={{ width: 90, textAlign: "right" }}>{money(it.amount_paise)}</Text>
            </View>
          ))}
        </View>

        <View style={[s.row, { marginTop: 16 }]}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            {doc.payments.length > 0 && (
              <View>
                <Text style={s.h}>Payments received</Text>
                {doc.payments.map((p, idx) => (
                  <Text key={idx} style={s.muted}>
                    {formatDate(p.paid_at)} · {label(PAYMENT_METHODS, p.method)} · {money(p.amount_paise)}
                    {p.reference ? ` · Ref ${p.reference}` : ""}
                  </Text>
                ))}
              </View>
            )}
            {i.notes && <Text style={[s.muted, { marginTop: 8 }]}>{i.notes}</Text>}
            {i.status === "cancelled" && i.cancelled_reason && (
              <Text style={{ marginTop: 8, color: "#c0304d" }}>Cancelled: {i.cancelled_reason}</Text>
            )}
          </View>
          <View style={{ width: 220 }}>
            <View style={s.totalRow}>
              <Text style={s.muted}>Subtotal</Text>
              <Text>{money(i.subtotal_paise)}</Text>
            </View>
            {i.discount_paise > 0 && (
              <View style={s.totalRow}>
                <Text style={s.muted}>Discount</Text>
                <Text>- {money(i.discount_paise)}</Text>
              </View>
            )}
            <View style={s.totalRow}>
              <Text style={s.muted}>Taxable value</Text>
              <Text>{money(i.taxable_paise)}</Text>
            </View>
            {Number(i.gst_rate) > 0 && (
              <>
                <View style={s.totalRow}>
                  <Text style={s.muted}>CGST @ {halfRate}%</Text>
                  <Text>{money(i.cgst_paise)}</Text>
                </View>
                <View style={s.totalRow}>
                  <Text style={s.muted}>SGST @ {halfRate}%</Text>
                  <Text>{money(i.sgst_paise)}</Text>
                </View>
              </>
            )}
            <View style={s.grand}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>Total</Text>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 11 }}>{money(i.total_paise)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={s.muted}>Paid</Text>
              <Text>{money(i.amount_paid_paise)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>Balance due</Text>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{money(outstanding)}</Text>
            </View>
          </View>
        </View>

        <View style={{ position: "absolute", bottom: 36, left: 40, right: 40 }} fixed>
          <View style={[s.between, { borderTopWidth: 1, borderTopColor: "#e3e7ee", paddingTop: 8 }]}>
            <Text style={s.muted}>
              {g.gst_enabled && g.gstin ? "This is a computer-generated tax invoice." : "This is a computer-generated invoice."}
            </Text>
            <Text style={s.muted}>For {g.legal_name || g.name} · Authorised signatory</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf doc={doc} />);
}

export function pdfResponse(buf: Buffer, filename: string, inline = true) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
