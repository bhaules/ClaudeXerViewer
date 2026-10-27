// "Save Viewer with Schedule": writes a copy of this HTML page with the .xer bytes
// inside (gzipped, base64), so the recipient gets one file that opens straight to
// the schedule.

const EMBED_ID = "xer-embedded";

/**
 * The page as it was before the app touched the DOM. Must be captured at startup,
 * before anything renders. Module scripts run after parsing, so the whole document is here.
 */
let pristine = "";

export function capturePristineHtml(): void {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector(`#${EMBED_ID}`)?.remove();
  pristine = "<!DOCTYPE html>\n" + clone.outerHTML;
}

export interface EmbeddedFile {
  name: string;
  bytes: Uint8Array;
}

export async function readEmbedded(): Promise<EmbeddedFile | null> {
  const node = document.getElementById(EMBED_ID);
  if (!node?.textContent) return null;
  const gz = base64ToBytes(node.textContent.trim());
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return { name: node.dataset.name || "schedule.xer", bytes };
}

export async function buildEmbeddedHtml(file: EmbeddedFile): Promise<string> {
  if (!pristine) throw new Error("Page source was not captured at startup.");
  const stream = new Blob([file.bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  const gz = new Uint8Array(await new Response(stream).arrayBuffer());
  const close = "<" + "/script>";
  const tag = `<script id="${EMBED_ID}" type="application/x-xer-gzip-base64" data-name="${escapeAttr(file.name)}">${bytesToBase64(gz)}${close}`;
  const at = pristine.lastIndexOf("</body>");
  return at === -1 ? pristine + tag : pristine.slice(0, at) + tag + "\n" + pristine.slice(at);
}

export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
