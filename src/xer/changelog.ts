// Help > What's New: a brief list from CHANGELOG.md, and version comparison for the
// update check. No DOM; runs in tests.

export interface ReleaseNotes {
  version: string;
  date: string;
  /** [section ("Added", ...), one line per change]. */
  sections: [string, string[]][];
}

/**
 * Reads CHANGELOG.md. Each change is a bullet starting with a bold lead ("- **Tab icon.**
 * ..."); the brief line is that lead plus its first sentence. Sub-bullets are left out.
 */
export function parseChangelog(md: string): ReleaseNotes[] {
  const out: ReleaseNotes[] = [];
  let section: [string, string[]] | null = null;
  let bullet: string | null = null;
  const flush = () => {
    if (bullet !== null && section) section[1].push(brief(bullet));
    bullet = null;
  };
  for (const line of md.replace(/\r/g, "").split("\n")) {
    const head = /^## (\d+\.\d+\.\d+)(?: \(([^)]*)\))?/.exec(line);
    if (head) {
      flush();
      section = null;
      out.push({ version: head[1], date: head[2] ?? "", sections: [] });
      continue;
    }
    const release = out[out.length - 1];
    if (!release) continue;
    if (line.startsWith("### ")) {
      flush();
      section = [line.slice(4).trim(), []];
      release.sections.push(section);
    } else if (line.startsWith("- ")) {
      flush();
      if (!section) release.sections.push((section = ["", []]));
      bullet = line.slice(2).trim();
    } else if (bullet !== null && /^ {2}[^ -]/.test(line)) {
      bullet += " " + line.trim();
    } else {
      flush(); // a blank line or sub-bullets end the lead text
    }
  }
  flush();
  return out;
}

function brief(bullet: string): string {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/.exec(bullet);
  const plain = (s: string) => s.replace(/\*\*|`/g, "").trim();
  if (!m) return plain(bullet);
  const lead = plain(m[1]).replace(/[.:]+$/, "");
  const rest = plain(m[2]).replace(/\.\.\./g, "…");
  const sentence = /^(.*?[.:])(?:\s|$)/.exec(rest);
  const text = (sentence ? sentence[1] : rest).replace(/[.:]$/, "");
  return text ? `${lead}: ${text}` : lead;
}

/** Negative when `a` is older than `b`. Accepts "0.9.0" or "v0.9.0". */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
