import { LocalParseError } from "./local-parse.js";

// Shared by multipart and pasted inputs. Hold through publication and disposal,
// so completed output files cannot accumulate behind a slow object store.
const active = new Set<symbol>();
let closing = false;
export function reserveLocalIntake(): { token: symbol; release: () => void } {
  if (closing) throw new LocalParseError("DATA_PARSE_CANCELLED");
  if (active.size) throw new LocalParseError("DATA_PARSE_BUSY");
  const token = Symbol("local-intake");
  active.add(token);
  return {
    token,
    release: () => {
      active.delete(token);
    },
  };
}
export function hasLocalIntakeReservation(token: symbol) {
  return active.has(token);
}
export function stopLocalIntake() {
  closing = true;
}
