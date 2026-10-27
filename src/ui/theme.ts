// Colours shared by the grid (CSS) and the Gantt (canvas).

/** WBS band [background, text] by level; deeper levels reuse the last entry. Same palette as the Python app. */
export const WBS_LEVEL_COLORS: [string, string][] = [
  ["#0070c0", "#ffffff"],
  ["#4472c4", "#ffffff"],
  ["#5b9bd5", "#ffffff"],
  ["#9bc2e6", "#000000"],
  ["#bdd7ee", "#000000"],
  ["#ddebf7", "#000000"],
];

export function wbsColors(level: number): [string, string] {
  return WBS_LEVEL_COLORS[Math.min(level, WBS_LEVEL_COLORS.length - 1)];
}

export const GANTT = {
  actual: "#1f4fd8",
  remaining: "#21a336",
  critical: "#e0201b",
  summary: "#1d2b53",
  dataDate: "#1a56db",
  relationship: "#26323f",
  gridLine: "#e6e6e6",
  majorLine: "#c8c8c8",
  selection: "rgba(70, 140, 220, 0.18)",
  headerBg: "#f0f0f0",
  headerText: "#333333",
  headerLine: "#c0c0c0",
};

export const ROW_HEIGHT = 22;
export const HEADER_HEIGHT = 38;
