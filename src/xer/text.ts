// P6 notebook notes and step descriptions are stored as HTML (or plain text), with 0x7F
// between lines. The viewer shows them as plain text: no markup from the file is ever
// put into the page.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(s: string | undefined): string {
  if (!s) return "";
  let t = s.replace(/\x7f/g, "\n").replace(/\r\n?/g, "\n");
  if (/<[a-z!/][^>]*>/i.test(t)) {
    t = t
      .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\n/g, " ") // in HTML, line breaks in the source are just spaces
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|div|h[1-6]|tr|ul|ol|table)\s*>/gi, "\n")
      .replace(/<(p|div|h[1-6]|tr)\b[^>]*>/gi, "\n")
      .replace(/<\/t[dh]\s*>/gi, "\t")
      .replace(/<[^>]*>/g, "");
  }
  t = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  return t
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
