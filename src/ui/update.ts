// Update check: asks GitHub for the latest release. This is the only network request the
// viewer makes. It sends nothing about the schedule or the user, and fails silently.
import { compareVersions } from "../xer/changelog";
import { el, esc, modal } from "./dom";

const REPO = "bhaules/ClaudeXerViewer";
const RELEASES = `https://github.com/${REPO}/releases/`;
const KEY = "xer-viewer-update-v1";
/** At startup the last answer is reused for this long, to stay under GitHub's request limit. */
const REUSE_MS = 4 * 3_600_000;

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

/** At startup: prompts if there is a newer version that hasn't been skipped. Silent otherwise. */
export async function checkForUpdateAtStart(): Promise<void> {
  const saved = load();
  let release = saved.release;
  const age = Date.now() - (saved.checked ?? 0);
  if (!release || age < 0 || age > REUSE_MS) {
    try {
      release = await fetchLatest();
      save({ checked: Date.now(), release });
    } catch {
      return; // offline or blocked
    }
  }
  if (!trusted(release.download) || !trusted(release.page)) return;
  if (compareVersions(release.version, __APP_VERSION__) > 0 && release.version !== saved.skip) prompt(release, true);
}

/** Help > Check for Updates. */
export async function checkForUpdateNow(): Promise<void> {
  try {
    const release = await fetchLatest();
    save({ checked: Date.now(), release });
    if (compareVersions(release.version, __APP_VERSION__) > 0) prompt(release, false);
    else modal("Check for Updates", `<p>You have the latest version (${esc(__APP_VERSION__)}).</p>`);
  } catch {
    modal(
      "Check for Updates",
      `<p>Couldn't reach GitHub to check. You may be offline, or your network blocks it.</p>` +
        `<p>You have version ${esc(__APP_VERSION__)}. Releases: <b>github.com/${REPO}/releases</b></p>`,
    );
  }
}

function prompt(r: Release, canSkip: boolean): void {
  const box = modal(
    "Update Available",
    `<p><b>XER Viewer ${esc(r.version)}</b> is available. You have ${esc(__APP_VERSION__)}.</p>` +
      `<p>${esc(r.title)}</p>` +
      `<p class="dlg-note">The download is a new file: open it and use it instead of this one. Your columns and settings should carry over in this browser.</p>`,
  );
  const foot = box.querySelector(".mfoot")!;
  const later = foot.querySelector("button")!;
  later.textContent = "Not Now";
  later.classList.remove("primary");
  const link = (label: string, href: string, cls: string) => {
    const a = el("a", cls, [label]);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  };
  const download = link(`Download ${r.version}`, r.download, "btn primary");
  download.addEventListener("click", () => setTimeout(() => later.click()));
  foot.classList.add("upd-foot");
  foot.prepend(download, link("Release Notes", r.page, "btn"));
  if (canSkip) {
    const skip = el("button", "btn", ["Skip This Version"]);
    skip.addEventListener("click", () => {
      save({ skip: r.version });
      later.click();
    });
    foot.append(skip);
  }
  download.focus();
}
