import type { SimInputs } from "../engine/types";
import { DEFAULT_INPUTS } from "./assumptions";

/**
 * Optional private profile. Copy `profile.local.example.ts` to
 * `profile.local.ts` (gitignored) and fill in your numbers; it is picked up
 * here at build time, so your data never enters git or the shared repo. If the
 * file is absent (anyone who clones the repo), this resolves to null and the app
 * falls back to the neutral example.
 *
 * import.meta.glob returns an empty object when nothing matches, so the missing
 * file is not a build error — the standard Vite pattern for an optional module.
 */
interface LocalModule {
  default: Partial<SimInputs>;
  /**
   * Optional: translate your own older saved data (renamed fields, etc.) into
   * the current shape. Applied to the saved session, saved scenarios, and
   * imported JSON files.
   */
  migrateSaved?: (raw: unknown) => unknown;
}

const matches = import.meta.glob<LocalModule>("./profile.local.ts", { eager: true });
const mod = Object.values(matches)[0];
const local = mod?.default;

/** The private local profile merged onto the example, or null if none exists. */
export const LOCAL_PROFILE: SimInputs | null = local
  ? { ...DEFAULT_INPUTS, ...local, balances: { ...DEFAULT_INPUTS.balances, ...local.balances } }
  : null;

export const HAS_LOCAL_PROFILE = LOCAL_PROFILE !== null;

/** Pass loaded data through the local profile's migration hook, if it has one. */
export function migrateSaved<T>(raw: T): T {
  return mod?.migrateSaved ? (mod.migrateSaved(raw) as T) : raw;
}
