// Raw XER text -> tables. No knowledge of what the tables mean.

export type Row = Record<string, string>;

export interface XerTables {
  header: string[];
  tables: Map<string, Row[]>;
}

export class XerParseError extends Error {}

/** P6 writes XER in Windows-1252. Fall back to UTF-8 only if it is valid UTF-8 with a BOM. */
export function decodeXer(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

export function parseXer(text: string): XerTables {
  if (!text.startsWith("ERMHDR")) {
    throw new XerParseError("This doesn't look like a P6 XER file (missing ERMHDR header).");
  }

  const tables = new Map<string, Row[]>();
  let header: string[] = [];
  let rows: Row[] | null = null;
  let fields: string[] = [];

  let pos = 0;
  const len = text.length;
  while (pos < len) {
    let end = text.indexOf("\n", pos);
    if (end === -1) end = len;
    let line = text.slice(pos, end);
    pos = end + 1;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.length < 2) continue;

    const tag = line.slice(0, 2);
    if (tag === "%R") {
      if (!rows) continue;
      const values = line.split("\t");
      const row: Row = {};
      for (let i = 0; i < fields.length; i++) row[fields[i]] = values[i + 1] ?? "";
      rows.push(row);
    } else if (tag === "%T") {
      const name = line.split("\t")[1]?.trim() ?? "";
      rows = [];
      fields = [];
      tables.set(name, rows);
    } else if (tag === "%F") {
      fields = line.split("\t").slice(1).map((f) => f.trim());
    } else if (tag === "%E") {
      break;
    } else if (line.startsWith("ERMHDR")) {
      header = line.split("\t");
    }
  }

  return { header, tables };
}
