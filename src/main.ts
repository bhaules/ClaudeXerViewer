import { capturePristineHtml, readEmbedded, readEmbeddedBaseline, readEmbeddedComments, type EmbeddedFile } from "./embed";
import "./styles.css";
import { App } from "./ui/app";
import { modal } from "./ui/dom";

// Must run before the app renders anything into the page.
capturePristineHtml();

const app = new App(document.getElementById("app")!);

async function start(): Promise<void> {
  let embedded: EmbeddedFile | null;
  try {
    embedded = await readEmbedded();
  } catch (e) {
    console.error(e);
    modal(
      "Can't open the saved schedule",
      `<p>The schedule saved inside this file is damaged, so it can't be shown.</p>` +
        `<p>Ask whoever sent it for a new copy, or open the .xer with File &gt; Open.</p>`,
    );
    return; // still a saved copy: no update check
  }
  if (embedded) {
    await app.load(embedded.name, embedded.bytes, readEmbeddedComments());
    try {
      const baseline = await readEmbeddedBaseline();
      if (baseline) await app.setBaseline(baseline.name, baseline.bytes);
    } catch (e) {
      console.error(e);
      modal("Baseline not loaded", `<p>The baseline saved inside this file is damaged, so the schedule is shown without it.</p>`);
    }
    app.markSavedCopy();
    return; // a saved copy is a snapshot someone was sent: it doesn't check for updates
  }
  app.checkForUpdate();
  // Dev convenience: /?file=/tests/fixtures/sample.xer
  const file = import.meta.env.DEV ? new URLSearchParams(location.search).get("file") : null;
  if (file) {
    const res = await fetch(file);
    await app.load(file.split("/").pop()!, new Uint8Array(await res.arrayBuffer()));
    // ...&baseline=/tests/fixtures/other.xer to try the comparison.
    const bl = new URLSearchParams(location.search).get("baseline");
    if (bl) await app.setBaseline(bl.split("/").pop()!, new Uint8Array(await (await fetch(bl)).arrayBuffer()));
  }
}

void start();
