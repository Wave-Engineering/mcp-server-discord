/**
 * Lone-surrogate sanitization.
 *
 * A lone unpaired UTF-16 surrogate (a high surrogate U+D800–U+DBFF with no
 * following low surrogate, or a low surrogate U+DC00–U+DFFF with no preceding
 * high) cannot be encoded as valid JSON. When such a codepoint reaches an agent
 * transcript it makes every subsequent API request fail with
 * `400 ... no low surrogate in string`, hard-jamming the session (cc-workflow
 * incident 2026-06-19). We strip them at the disc boundary in BOTH directions:
 * inbound on `disc_read` (protect ourselves from poisoned pulls — we can't make
 * other senders emit clean text) and outbound on `disc_send` (protect other
 * agents — never be the one who jams someone else's session).
 *
 * Valid surrogate PAIRS (ordinary emoji / astral-plane characters) are left
 * untouched; only unpaired halves are replaced with U+FFFD (the Unicode
 * replacement character).
 */

/** Replace any unpaired UTF-16 surrogate in `s` with U+FFFD; valid pairs are preserved. */
export function sanitizeSurrogates(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate: valid only if immediately followed by a low surrogate.
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++; // consume the paired low surrogate
      } else {
        out += "�";
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // Low surrogate with no preceding high surrogate (those are consumed above).
      out += "�";
    } else {
      out += s[i];
    }
  }
  return out;
}
