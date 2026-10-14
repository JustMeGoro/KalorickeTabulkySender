// Shared helpers for the list of people the Oběd is sent to.
//
// KT_SEND_TO in .env is a comma-separated list of the Kalorické tabulky e-mails (or identifiers) of the
// recipients, e.g.  KT_SEND_TO=me@gmail.com, friend@example.com
// Every recipient must already be a connected person of the bot account (the same list you see when
// sharing Oběd by hand).
//
// sent.json keeps, per day, who already got it:  { "2026-10-14": { "me@gmail.com": "<timestamp>" } }
// The old format (a single timestamp string) is read as "everyone on the list already got it".

export function parseRecipients(value) {
  const list = (value ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  return list.filter((r) => {
    const key = r.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// When was this day sent to this recipient? (undefined = not yet)
export function sentAt(entry, recipient) {
  if (!entry) return undefined;
  if (typeof entry === "string") return entry; // legacy format: sent to everyone
  const key = Object.keys(entry).find((k) => k.toLowerCase() === recipient.toLowerCase());
  return key ? entry[key] : undefined;
}

export const missingRecipients = (entry, recipients) => recipients.filter((r) => !sentAt(entry, r));

export function markSent(sent, isoDate, recipient, when = new Date().toISOString()) {
  const entry = sent[isoDate];
  // a legacy string entry is kept as is: it already covers everyone currently on the list
  if (typeof entry === "string") return;
  sent[isoDate] = { ...(entry ?? {}), [recipient]: when };
}
