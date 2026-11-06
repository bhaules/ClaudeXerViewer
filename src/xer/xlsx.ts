// File > Export to Excel: the grid's rows and columns as an .xlsx workbook, written by
// hand (a zip of a few XML files) so the viewer needs no library. No DOM; runs in tests.
import type { Column, ColumnContext } from "./columns";
import { parseDateInput, parseNumber } from "./filter";
import type { Activity } from "./model";
import type { GridRow } from "./rows";

export interface ExportColumn {
  column: Column;
  /** Grid width in pixels, turned into an Excel column width. */
  width: number;
}

export interface ExportOptions {
  sheetName: string;
  columns: ExportColumn[];
  rows: GridRow[];
  ctx: ColumnContext;
  /** [background, text] colour of a WBS band at this level, as "#rrggbb". */
  wbsColors(level: number): [string, string];
  /** Label / value pairs for the "Export Info" sheet (source file, filters, sort...). */
  info: [string, string][];
}

const DAY = 86_400_000;
/** Excel's serial date for 1970-01-01. */
const EXCEL_EPOCH = 25569;
const UNIT_LABELS = { h: "h", d: "d", w: "w", m: "mo" } as const;

/**
 * Builds the workbook. Activity dates and numbers become real Excel dates and numbers;
 * WBS bands keep their colours and become outline levels, so Excel's row grouping
 * expands and collapses them. The header row is frozen and has an AutoFilter.
 */
export async function buildActivitiesXlsx(o: ExportOptions): Promise<Uint8Array> {
  const styles = new StyleTable();
  const head = styles.get({ kind: "t", bold: true, fill: "#d9d9d9", color: "#000000", indent: 0, align: "wrap" });
  const unit = UNIT_LABELS[o.ctx.unit];
  const labels = o.columns.map(({ column: c }) => (c.group === "Durations" ? `${c.label} (${unit})` : c.label));

  const out = [
    `<row r="1" ht="30" customHeight="1">${labels.map((l, i) => textCell(colName(i) + 1, head, l)).join("")}</row>`,
  ];
  let maxLevel = 0;
  o.rows.forEach((row, ri) => {
    const r = ri + 2;
    const isWbs = row.kind === "wbs";
    const [fill, color] = isWbs ? o.wbsColors(row.level) : [null, null];
    const level = Math.min(row.level, 7); // Excel allows 7 outline levels
    maxLevel = Math.max(maxLevel, level);
    let cells = "";
    o.columns.forEach(({ column: c }, ci) => {
      const ref = colName(ci) + r;
      const indent = ci === 0 ? Math.min(row.level * 2, 15) : 0;
      const align = c.align === "right" ? "right" : c.align === "center" ? "center" : "left";
      const [kind, value] = row.kind === "wbs" ? wbsValue(c, c.wbsText(row.wbs, o.ctx)) : actValue(c, row.act, o.ctx);
      const style = styles.get({ kind, bold: isWbs, fill, color, indent, align });
      if (value === "") {
        if (isWbs) cells += `<c r="${ref}" s="${style}"/>`; // keep the band's colour across the row
        return;
      }
      cells += kind === "t" ? textCell(ref, style, value) : `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    });
    out.push(`<row r="${r}"${level ? ` outlineLevel="${level}"` : ""}>${cells}</row>`);
  });

  const lastCol = colName(o.columns.length - 1);
  const range = `A1:${lastCol}${o.rows.length + 1}`;
  const frozen = Math.min(2, o.columns.length); // Activity ID and Name stay in view
  const colsXml = o.columns
    .map(({ width }, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.min(80, Math.round(width / 6.5)))}" customWidth="1"/>`)
    .join("");
  const sheet =
    `${XML}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetPr><outlinePr summaryBelow="0"/></sheetPr>` +
    `<dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="${frozen}" ySplit="1" topLeftCell="${colName(frozen)}2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"${maxLevel ? ` outlineLevelRow="${maxLevel}"` : ""}/><cols>${colsXml}</cols>` +
    `<sheetData>${out.join("")}</sheetData><autoFilter ref="${range}"/>` +
    `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const infoRows = o.info
    .map(([k, v], i) => `<row r="${i + 1}">${textCell(`A${i + 1}`, head, k)}${textCell(`B${i + 1}`, 0, v)}</row>`)
    .join("");
  const infoSheet = `${XML}<worksheet xmlns="${NS_MAIN}"><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="90" customWidth="1"/></cols><sheetData>${infoRows}</sheetData></worksheet>`;

  const name = escapeXml(o.sheetName.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Activities");
  const quoted = `'${name.replace(/'/g, "''")}'`;
  const workbook =
    `${XML}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>` +
    `<sheet name="${name}" sheetId="1" r:id="rId1"/><sheet name="Export Info" sheetId="2" r:id="rId2"/></sheets><definedNames>` +
    `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${quoted}!$A$1:$${lastCol}$${o.rows.length + 1}</definedName>` +
    `<definedName name="_xlnm.Print_Titles" localSheetId="0">${quoted}!$1:$1</definedName></definedNames></workbook>`;

  return zip([
    ["[Content_Types].xml", CONTENT_TYPES],
    ["_rels/.rels", ROOT_RELS],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", WORKBOOK_RELS],
    ["xl/styles.xml", styles.xml()],
    ["xl/worksheets/sheet1.xml", sheet],
    ["xl/worksheets/sheet2.xml", infoSheet],
  ]);
}

type CellKind = "t" | "n" | "d";

function actValue(c: Column, a: Activity, ctx: ColumnContext): [CellKind, string] {
  if (c.kind !== "text") {
    const v = c.sortValue(a, ctx);
    if (typeof v === "number" && Number.isFinite(v)) {
      return c.kind === "date" ? ["d", String(Math.floor(v / DAY) + EXCEL_EPOCH)] : ["n", String(Math.round(v * 100) / 100)];
    }
  }
  return ["t", c.text(a, ctx)];
}

/** WBS bands only have display text; turn dates and numbers back into values where possible. */
function wbsValue(c: Column, text: string): [CellKind, string] {
  if (text && c.kind === "date") {
    const d = parseDateInput(text);
    if (d !== null) return ["d", String(d / DAY + EXCEL_EPOCH)];
  }
  if (text && c.kind === "number") {
    const n = parseNumber(text);
    if (n !== null) return ["n", String(n)];
  }
  return ["t", text];
}

function textCell(ref: string, style: number, text: string): string {
  return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Escapes XML and drops control characters Excel refuses to open. */
function escapeXml(s: string): string {
  return s
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

interface CellStyle {
  kind: CellKind;
  bold: boolean;
  fill: string | null;
  color: string | null;
  indent: number;
  align: "left" | "right" | "center" | "wrap";
}

/** Collects the distinct cell styles used; index 0 is Excel's default style. */
class StyleTable {
  private styles: CellStyle[] = [];
  private index = new Map<string, number>();

  get(s: CellStyle): number {
    const key = JSON.stringify(s);
    let i = this.index.get(key);
    if (i === undefined) {
      this.styles.push(s);
      i = this.styles.length;
      this.index.set(key, i);
    }
    return i;
  }

  xml(): string {
    const argb = (c: string) => "FF" + c.replace("#", "").toUpperCase();
    const fills: string[] = [];
    const fonts = [`<font><sz val="10"/><name val="Arial"/></font>`];
    const fontIndex = new Map<string, number>();
    const fillIndex = new Map<string, number>();
    const xfs = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
    for (const s of this.styles) {
      const fontKey = `${s.bold}|${s.color ?? ""}`;
      if (!fontIndex.has(fontKey)) {
        fontIndex.set(fontKey, fonts.length);
        fonts.push(`<font>${s.bold ? "<b/>" : ""}<sz val="10"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : ""}<name val="Arial"/></font>`);
      }
      if (s.fill && !fillIndex.has(s.fill)) {
        fillIndex.set(s.fill, fills.length + 2); // after the two fills Excel requires
        fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`);
      }
      const h = s.align === "wrap" ? "center" : s.align === "left" && !s.indent ? "" : s.align;
      xfs.push(
        `<xf numFmtId="${s.kind === "d" ? 164 : 0}" fontId="${fontIndex.get(fontKey)}" fillId="${s.fill ? fillIndex.get(s.fill) : 0}" borderId="1" xfId="0" ` +
          `applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"` +
          `${h ? ` horizontal="${h}"` : ""}${s.indent ? ` indent="${s.indent}"` : ""}${s.align === "wrap" ? ` wrapText="1"` : ""}/></xf>`,
      );
    }
    const border = `<left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom>`;
    return (
      `${XML}<styleSheet xmlns="${NS_MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yy"/></numFmts>` +
      `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
      `<fills count="${fills.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills.join("")}</fills>` +
      `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${border}<diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    );
  }
}

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.spreadsheetml";
const CONTENT_TYPES =
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT}.worksheet+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="${CT}.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/></Types>`;
const ROOT_RELS = `${XML}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WORKBOOK_RELS =
  `${XML}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS_REL}/worksheet" Target="worksheets/sheet2.xml"/>` +
  `<Relationship Id="rId3" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;

export const XLSX_TYPE = `${CT}.sheet`;

// ---------- Zip ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // older browsers: store uncompressed
  }
}

/** A minimal zip: each file deflated (or stored if that's no smaller), UTF-8 names. */
export async function zip(files: [string, string][]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const [name, text] of files) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const crc = crc32(raw);
    const packed = await deflateRaw(raw);
    const data = packed && packed.length < raw.length ? packed : raw;
    const method = data === raw ? 0 : 8;

    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(8, method, true);
    h.setUint16(10, time, true);
    h.setUint16(12, date, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, raw.length, true);
    h.setUint16(26, nameBytes.length, true);
    local.push(new Uint8Array(h.buffer), nameBytes, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, raw.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
