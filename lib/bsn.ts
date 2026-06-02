/**
 * BSN (Burgerservicenummer) validation — a pure, dependency-free utility so it
 * is identically usable by the Convex create mutation (server-side, the
 * authoritative gate) and by the new-patient form (client-side, for fast
 * feedback). It is independently unit-tested in `bsn.test.ts` (BR-2).
 *
 * AVG/GDPR (BR-11): a BSN is patient-identifying data. Nothing in this module
 * logs, prints, throws, or otherwise emits the BSN value. The functions return
 * a boolean / a normalized string only; the caller decides how to surface a
 * failure WITHOUT echoing the value (e.g. a field-level error referencing the
 * field, never the number).
 */

/** A BSN is exactly nine digits. */
const BSN_LENGTH = 9;

/**
 * Multiplier weights for the Elfproef ("eleven test"), applied left-to-right to
 * the nine digits: 9, 8, 7, 6, 5, 4, 3, 2 for the first eight digits and -1 for
 * the last (check) digit. The weighted sum must be divisible by 11.
 */
const ELFPROEF_WEIGHTS = [9, 8, 7, 6, 5, 4, 3, 2, -1] as const;

/**
 * Normalize loosely-typed BSN input to its canonical nine-character digit
 * string, or `null` if it cannot be a BSN. Surrounding whitespace is trimmed;
 * any other non-digit content (separators, letters) makes it invalid. A
 * shorter all-digit value is left-padded to nine characters, because a BSN with
 * leading zeros is often entered/stored without them — `"123456782"` and a
 * stored `"012345678"` style value must both be evaluable. The padded result is
 * still length-checked, so anything longer than nine digits is rejected.
 */
export function normalizeBsn(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  if (trimmed.length > BSN_LENGTH) {
    return null;
  }
  return trimmed.padStart(BSN_LENGTH, "0");
}

/**
 * Returns whether `input` is a valid BSN: exactly nine digits (after
 * normalization) that pass the Elfproef. The all-zeros string `"000000000"`
 * passes the arithmetic but is not a real BSN, so it is rejected explicitly.
 *
 * Does not throw and never emits the value (BR-11) — a malformed input simply
 * returns `false`.
 */
export function isValidBsn(input: string): boolean {
  const normalized = normalizeBsn(input);
  if (normalized === null) {
    return false;
  }
  if (normalized === "0".repeat(BSN_LENGTH)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < BSN_LENGTH; i++) {
    // `normalized` is exactly BSN_LENGTH digits, so each charAt is a digit.
    const digit = normalized.charCodeAt(i) - 48;
    const weight = ELFPROEF_WEIGHTS[i] ?? 0;
    sum += digit * weight;
  }
  return sum % 11 === 0;
}
