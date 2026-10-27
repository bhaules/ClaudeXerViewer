import { buildSchedule, type Schedule } from "./model";
import { decodeXer, parseXer } from "./parse";

export function loadSchedule(bytes: Uint8Array): Schedule {
  return buildSchedule(parseXer(decodeXer(bytes)));
}
