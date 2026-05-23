import { randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;
const states = new Map<string, number>();

export function issueState(): string {
  const s = randomBytes(16).toString("hex");
  states.set(s, Date.now() + STATE_TTL_MS);
  return s;
}

export function consumeState(s: string): boolean {
  const exp = states.get(s);
  if (!exp) return false;
  states.delete(s);
  if (Date.now() > exp) return false;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of states) if (exp < now) states.delete(k);
}, 60_000).unref?.();
