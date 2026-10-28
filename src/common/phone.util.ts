/** Canonical phone format used for storage/comparison across the app: +91 followed by the
 * 10-digit subscriber number. Callers (mobile app, admin panel) send phone numbers in varying
 * shapes ("9982925680", "+919982925680", "09982925680", with spaces/dashes) — without
 * normalizing, two representations of the same number are treated as different users, which
 * let an OTP login silently create a duplicate account for an admin whose number was stored
 * without the +91 prefix. */
export function normalizePhone(raw: string): string {
  const digitsOnly = (raw || '').replace(/\D/g, '');
  const last10 = digitsOnly.slice(-10);
  return last10.length === 10 ? `+91${last10}` : digitsOnly;
}

/** All plausible historical formats for a phone number, so lookups keep matching rows written
 * before normalization was enforced (e.g. "9982925680" saved without a country code). */
export function phoneLookupVariants(raw: string): string[] {
  const digitsOnly = (raw || '').replace(/\D/g, '');
  const last10 = digitsOnly.slice(-10);
  if (last10.length !== 10) return [raw];
  return Array.from(new Set([`+91${last10}`, last10, `0${last10}`, `91${last10}`, raw]));
}
