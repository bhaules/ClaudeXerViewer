// Update check: asks GitHub for the latest release. This is the only network request the
// viewer makes. It sends nothing about the schedule or the user, and fails silently.
// A newer version is announced in a bar under the toolbar, not a popup, so it never gets in
// the way. The page keeps checking while it stays open (pinned tabs stay open for weeks).
import { compareVersions } from "../xer/changelog";
import { el, esc, modal } from "./dom";

const REPO = "bhaules/ClaudeXerViewer";
const RELEASES = `https://github.com/${REPO}/releases/`;
const KEY = "xer-viewer-update-v1";
/** GitHub is asked at most this often (per browser), to stay under its request limit. */
const REUSE_MS = 4 * 3_600_000;
/** How often an open page looks again (it only asks GitHub when the saved answer is stale). */
const POLL_MS = 30 * 60_000;

export interface Release {
  version: string;
  title: string;
  /** Download link of the .html file, or the release page. */
  download: string;
  page: string;
}

interface Saved {
  checked?: number;
  release?: Release;
  /** Version the user chose to skip. */
  skip?: string;
}

function load(): Saved {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Saved | null) ?? {};
  } catch {
    return {};
  }
}

function save(change: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...change }));
  } catch {
    // Storage blocked: it just checks again next time.
  }
}

/** Only links to this project's own releases are ever offered. */
const trusted = (url: unknown): url is string => typeof url === "string" && url.startsWith(RELEASES);

async function fetchLatest(): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = (await res.json()) as {
    tag_name?: string;
    name?: string;
    html_url?: string;
    assets?: { name?: string; browser_download_url?: string }[];
  };
  const version = (r.tag_name ?? "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("unexpected answer from GitHub");
  const page = trusted(r.html_url) ? r.html_url : RELEASES + "latest";
  const asset = r.assets?.find((a) => /\.html$/i.test(a.name ?? ""))?.browser_download_url;
  return { version, title: r.name ?? `v${version}`, download: trusted(asset) ? asset : page, page };
}

const isNewer = (r: Release) =>
  compareVersions(r.version, __APP_VERSION__) > 0 && trusted(r.download) && trusted(r.page);

// ---------- The bar ----------

let bar: HTMLElement | null = null;
/** Version closed with × on this page: not shown again until the page is reopened. */
let closed = "";

/** The notification bar (hidden until there is an update). The app puts it under the toolbar. */
export function updateBar(): HTMLElement {
  return (bar ??= el("div", "update-bar hidden"));
}

export function hideUpdateBar(): void {
  bar?.classList.add("hidden");
}

function showBar(r: Release): void {
  const b = updateBar();
  const link = (label: string, href: string, cls: string, tip: string) => {
    const a = el("a", cls, [label]);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = tip;
    return a;
  };
  const download = link(
    `Download ${r.version}`,
    r.download,
    "btn primary",
    "Downloads the new viewer as a new file: open it and use it instead of this one. Your columns and settings carry over in this browser.",
  );
  download.addEventListener("click", () => setTimeout(hideUpdateBar));
  const skip = el("button", "btn", ["Skip This Version"]);
  skip.title = "Don't mention this version again";
  skip.addEventListener("click", () => {
    save({ skip: r.version });
    hideUpdateBar();
  });
  const close = el("button", "xbtn", ["×"]);
  close.title = "Not now";
  close.addEventListener("click", () => {
    closed = r.version;
    hideUpdateBar();
  });
  const text = el("span", "upd-text");
  text.innerHTML = `<b>XER Viewer ${esc(r.version)}</b> is available. You have ${esc(__APP_VERSION__)}.`;
  b.replaceChildren(
    el("span", "upd-icon", ["↑"]),
    text,
    download,
    link("What's New", r.page, "btn", "The release notes on GitHub"),
    skip,
    el("span", "upd-gap"),
    close,
  );
  b.classList.remove("hidden");
}

// ---------- Checking ----------

let started = false;
let busy = false;
let enabled: () => boolean = () => true;

/** Uses the saved answer while it is fresh, otherwise asks GitHub. Silent on failure. */
async function checkQuietly(): Promise<void> {
  if (busy || !enabled()) return;
  busy = true;
  try {
    const saved = load();
    let release = saved.release;
    const age = Date.now() - (saved.checked ?? 0);
    if (!release || age < 0 || age > REUSE_MS) {
      release = await fetchLatest();
      save({ checked: Date.now(), release });
    }
    if (enabled() && isNewer(release) && release.version !== saved.skip && release.version !== closed) showBar(release);
  } catch {
    // offline or blocked: try again later
  } finally {
    busy = false;
  }
}

/**
 * Checks now, then every half hour and whenever the tab comes back into view, for as long as
 * the page is open. `isOn` is Help > Notify About Updates.
 */
export function startUpdateChecks(isOn: () => boolean): void {
  enabled = isOn;
  void checkQuietly();
  if (started) return;
  started = true;
  setInterval(() => void checkQuietly(), POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkQuietly();
  });
}

/** Help > Check for Updates Now: always asks GitHub and says what it found. */
export async function checkForUpdateNow(): Promise<void> {
  try {
    const release = await fetchLatest();
    save({ checked: Date.now(), release });
    if (isNewer(release)) {
      closed = "";
      showBar(release);
    } else modal("Check for Updates", `<p>You have the latest version (${esc(__APP_VERSION__)}).</p>`);
  } catch {
    modal(
      "Check for Updates",
      `<p>Couldn't reach GitHub to check. You may be offline, or your network blocks it.</p>` +
        `<p>You have version ${esc(__APP_VERSION__)}. Releases: <b>github.com/${REPO}/releases</b></p>`,
    );
  }
}
