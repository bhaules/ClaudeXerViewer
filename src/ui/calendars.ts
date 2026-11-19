// View > Calendars: each calendar's work week and a year view of its holidays and
// other exceptions, read from CALENDAR.clndr_data.
import type { DayRanges } from "../xer/calendar";
import { formatDate } from "../xer/format";
import type { Calendar, Schedule } from "../xer/model";
import { el, esc, modal } from "./dom";

const DAY = 86_400_000;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hours = (r: DayRanges) => r.reduce((n, [s, f]) => n + (f - s), 0) / 60;
const times = (r: DayRanges) => r.map(([s, f]) => `${hhmm(s)}–${f === 1440 ? "24:00" : hhmm(f)}`).join(", ");
const trim = (n: number) => String(Math.round(n * 100) / 100);

/** Opens the Calendars dialog, starting on `initial` (e.g. the selected activity's calendar). */
export function showCalendars(s: Schedule, initial: Calendar | null, year: number): void {
  const used = new Map<Calendar, number>();
  for (const a of s.activities) used.set(a.calendar, (used.get(a.calendar) ?? 0) + 1);
  // Calendars the activities use first (most used at the top), then the rest by name.
  const cals = [...s.calendars.values()].sort(
    (a, b) => (used.get(b) ?? 0) - (used.get(a) ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  if (!cals.length) {
    modal("Calendars", "<p>This file has no calendars.</p>");
    return;
  }
  let current = initial && cals.includes(initial) ? initial : cals[0];
  let shownYear = year;

  const box = modal("Calendars", "", "modal-wide cal-modal");
  const body = box.querySelector<HTMLElement>(".mbody")!;
  const list = el("div", "cal-list");
  const detail = el("div", "cal-detail");
  body.append(el("div", "cal-wrap", [list, detail]));

  const renderList = () => {
    list.innerHTML =
      `<table><thead><tr><th>Calendar</th><th title="Hours per day">Hrs/Day</th><th title="Activities using it">Acts</th></tr></thead><tbody>` +
      cals
        .map(
          (c, i) =>
            `<tr data-i="${i}" class="${c === current ? "sel" : ""}"><td title="${esc(c.name)}">${esc(c.name)}</td>` +
            `<td class="r">${trim(c.dayHrs)}</td><td class="r">${(used.get(c) ?? 0).toLocaleString()}</td></tr>`,
        )
        .join("") +
      `</tbody></table>`;
  };

  const renderDetail = () => {
    const w = current.work;
    const weekHrs = w.week.reduce((n, r) => n + hours(r), 0);
    // Monday first, like P6.
    const order = [1, 2, 3, 4, 5, 6, 0];
    // Days across, so the whole year still fits below without scrolling.
    const week =
      `<tr><th></th>${order.map((d) => `<th>${DAY_NAMES[d]}</th>`).join("")}</tr>` +
      `<tr><th>Hours</th>${order.map((d) => `<td>${trim(hours(w.week[d]))}</td>`).join("")}</tr>` +
      `<tr><th>Working times</th>${order.map((d) => `<td>${times(w.week[d]).replace(/, /g, "<br>") || "Non-work"}</td>`).join("")}</tr>`;

    const inYear = [...w.exceptions.keys()].filter((d) => new Date(d * DAY).getUTCFullYear() === shownYear).length;
    const months = MONTHS.map((name, m) => monthHtml(current, shownYear, m, name)).join("");
    detail.innerHTML =
      `<h3>${esc(current.name)}</h3>` +
      `<p class="cal-facts">${trim(current.dayHrs)} h/day · ${trim(current.weekHrs)} h/week · ${trim(current.monthHrs)} h/month` +
      ` · work week ${trim(weekHrs)} h · ${w.exceptions.size.toLocaleString()} exceptions</p>` +
      `<table class="cal-week"><tbody>${week}</tbody></table>` +
      `<div class="cal-yearbar"><button class="btn" data-y="-1" title="Previous year">◀</button><b>${shownYear}</b>` +
      `<button class="btn" data-y="1" title="Next year">▶</button><span>${inYear} exception${inYear === 1 ? "" : "s"} this year</span>` +
      `<span class="cal-key"><i class="k-work"></i>Work <i class="k-off"></i>Non-work <i class="k-hol"></i>Holiday / non-work exception <i class="k-exc"></i>Changed hours</span></div>` +
      `<div class="cal-year">${months}</div>`;
  };

  list.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-i]");
    if (!tr) return;
    current = cals[Number(tr.dataset.i)];
    renderList();
    renderDetail();
  });
  detail.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-y]");
    if (!b) return;
    shownYear += Number(b.dataset.y);
    renderDetail();
  });
  renderList();
  renderDetail();
}

function monthHtml(cal: Calendar, year: number, month: number, name: string): string {
  const first = Date.UTC(year, month, 1);
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() + 6) % 7; // Monday first
  let cells = "<i></i>".repeat(lead);
  for (let d = 1; d <= days; d++) {
    const ms = Date.UTC(year, month, d);
    const dayNo = Math.floor(ms / DAY);
    const exc = cal.work.exceptions.get(dayNo);
    const normal = cal.work.week[new Date(ms).getUTCDay()];
    const ranges = exc ?? normal;
    const h = hours(ranges);
    let cls = h > 0 ? "d-work" : "d-off";
    let tip = `${DAY_NAMES[new Date(ms).getUTCDay()]} ${formatDate(ms)}: `;
    if (exc && h === 0) {
      cls = "d-hol";
      tip += "non-work (exception)";
    } else if (exc) {
      cls = "d-exc";
      tip += `${trim(h)} h, ${times(exc)} (exception)`;
    } else {
      tip += h > 0 ? `${trim(h)} h, ${times(normal)}` : "non-work";
    }
    cells += `<span class="${cls}" title="${tip}">${d}</span>`;
  }
  return (
    `<div class="cal-month"><div class="cal-mname">${name}</div>` +
    `<div class="cal-days"><b>M</b><b>T</b><b>W</b><b>T</b><b>F</b><b>S</b><b>S</b>${cells}</div></div>`
  );
}
