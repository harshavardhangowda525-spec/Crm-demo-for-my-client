# WhatsApp templates to submit to Meta

Create each template in **WhatsApp Manager → Message templates → Create template**.
Use the **exact name**, language **English (en)**, the category shown, and paste the body.
`{{1}}`, `{{2}}`… are filled in by Gym OS in this order. Add the sample values when Meta asks.
You can edit the wording later in **Automations → (rule) → Template** — keep the variables in the same order and re-submit to Meta.

| # | Name | Category | Body | Sample values |
|---|---|---|---|---|
| 1 | `enquiry_thanks` | Utility | Hi {{1}}, thank you for visiting {{2}} today! We have noted your interest in {{3}}. Reply here any time if you have questions. | Rahul · Muscle House · Quarterly |
| 2 | `enquiry_follow_up` | Marketing | Hi {{1}}, thank you for visiting {{2}}! We wanted to check whether you had any questions about our membership plans. We'd be happy to help. | Rahul · Muscle House |
| 3 | `membership_confirmation` | Utility | Hi {{1}}, welcome to {{2}}! Your {{3}} membership is active from {{4}} to {{5}}. View your membership, invoices and pauses here: {{6}} We look forward to training with you. | Rahul · Muscle House · Quarterly · 13 Nov 2026 · 12 Feb 2027 · https://muscle-house-gym-os.onrender.com/portal/t/abc |
| 4 | `invoice_delivery` | Utility — header type **Document** | Hi {{1}}, here is your invoice {{2}} from {{3}} for {{4}}. Payment status: {{5}}. Thank you for being a member. | Rahul · MH/2026-27/0001 · Muscle House · ₹4,720.00 · paid |
| 5 | `expiry_reminder` | Utility | Hi {{1}}, your {{2}} membership at {{3}} ends on {{4}} ({{5}}). Renew at the front desk to keep training without a break. | Rahul · Quarterly · Muscle House · 12 Feb 2027 · in 3 days |
| 6 | `pause_confirmation` | Utility | Hi {{1}}, your membership pause from {{2}} to {{3}} is confirmed. {{4}} pause days used, {{5}} remaining. Your new expiry date is {{6}}. See you back soon! | Rahul · 15 Nov 2026 · 17 Nov 2026 · 3 · 4 · 15 Feb 2027 |
| 7 | `renewal_follow_up` | Marketing | Hi {{1}}, we miss you at {{2}}! Your {{3}} membership ended on {{4}}. Renew today and get back on track. | Rahul · Muscle House · Monthly · 10 Nov 2026 |
| 8 | `win_back` | Marketing | Hi {{1}}, it has been two weeks since your {{2}} membership at {{3}} ended. We would love to have you back. Reply to this message and we will help you restart. | Rahul · Monthly · Muscle House |
| 9 | `birthday_wishes` | Marketing | Happy birthday, {{1}}! Everyone at {{2}} wishes you a strong and healthy year ahead. | Rahul · Muscle House |
| 10 | `membership_anniversary` | Marketing | Hi {{1}}, today marks {{2}} since you joined {{3}}. Thank you for training with us! | Rahul · 1 year · Muscle House |
| 11 | `owner_daily_briefing` | Utility | Good morning {{1}}! Here is today’s summary for {{2}}: {{3}} follow-ups, {{4}} renewals due, {{5}} unpaid invoices and {{6}} birthdays. Top priorities: {{7}}. Open your Today list here: {{8}} Have a productive day! | Arun · Muscle House · 4 · 2 · 3 · 1 · Rahul K (overdue follow-up); Priya S (membership ends tomorrow) · https://muscle-house-gym-os.onrender.com/today |
| 12 | `owner_evening_summary` | Utility | Hi {{1}}, here is today’s wrap-up: {{2}} follow-ups logged, {{3}} payments ({{4}}) and {{5}} new enquiries. {{6}} items were carried over to tomorrow. View details here: {{7}} Have a good evening! | Arun · 6 · 3 · ₹12,980 · 4 · 2 · https://muscle-house-gym-os.onrender.com/today |
| 13 | `portal_link` | Utility | Hi {{1}}, you can view your {{2}} membership details, invoices and pauses using this member portal link: {{3}} The link stays active for {{4}} days. | Rahul · Muscle House · https://muscle-house-gym-os.onrender.com/portal/t/abc · 30 |
| 14 | `portal_otp` | **Authentication** (one-time password, "Copy code" button) | Your member portal code is {{1}}. It expires in 10 minutes. Do not share it with anyone. | 482913 |

Notes
- Meta rejects a template whose body ends with a variable (a trailing period still counts) — every body here ends with fixed text.
- Marketing templates are only sent to customers who agreed to WhatsApp updates (the consent tick box). Meta charges marketing messages at a higher rate than utility ones.
- Staff briefings (11, 12) go to the WhatsApp number each staff member saves in **Settings → Reminders**.
- Meta may re-categorise a template; that does not break anything in Gym OS.

## Backup while templates are in review (text fallback)

If Meta reports that a template is not approved yet (errors 132000–132016), the
CRM resends **the same rendered message as plain text** (invoices go as the PDF
document with the message as caption). These sends show the amber label
"Sent as text (template pending approval)" in Automations → Execution history.

WhatsApp only allows free-form messages within **24 hours of the recipient
messaging the business number**. Before a demo, send "Hi" from the phone that
should receive messages to the business number. Outside that window the message
fails with a clear explanation instead of being retried.

Turn it off with the Render env var `WHATSAPP_TEXT_FALLBACK=off` (default `on`).
Once templates are approved, templates are used automatically; the backup only
kicks in when a template can't be used.
