import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

export const DEFAULT_COUNTRY: CountryCode = "IN";

/**
 * Normalises user-typed phone numbers to E.164 ("+919876543210").
 * Accepts "98765 43210", "09876543210", "+91-98765-43210", "919876543210".
 * Returns null when the input is not a valid number.
 */
export function normalizePhone(input: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let candidate = raw.replace(/[^\d+]/g, "");
  // "91XXXXXXXXXX" typed without + for India
  if (country === "IN" && /^91\d{10}$/.test(candidate)) candidate = "+" + candidate;
  const parsed = parsePhoneNumberFromString(candidate, country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/**
 * Converts partial input into the E.164 prefix used for "search as you type".
 * "98765" → "+9198765". Returns null when there are fewer than 3 digits.
 */
export function phoneSearchPrefix(input: string, country: CountryCode = DEFAULT_COUNTRY): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 3) return null;
  if (trimmed.startsWith("+")) return "+" + digits;
  if (country === "IN") {
    if (digits.length > 10 && digits.startsWith("91")) return "+" + digits;
    return "+91" + digits.replace(/^0+/, "");
  }
  return "+" + digits;
}

export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}
