import { capturePristineHtml, readEmbedded, readEmbeddedBaseline, readEmbeddedComments } from "./embed";
import "./styles.css";
import { App } from "./ui/app";

// Must run before the app renders anything into the page.
capturePristineHtml();

const app = new App(document.getElementById("app")!);

async function start(): Promise<void> {
  const embedded = await readEmbedded();
  if (embedded) {
    await app.load(embedded.name, embedded.bytes, readEmbeddedComments());
    const baseline = await readEmbeddedBaseline();
    if (baseline) await app.setBaseline(baseline.name, baseline.bytes);
    return;
  }
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
