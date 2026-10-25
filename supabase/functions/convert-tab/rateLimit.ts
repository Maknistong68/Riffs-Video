/**
 * Sliding-window rate limiter keyed by anonymous device id (and client IP as a backstop).
 * In-memory per function instance: no tables needed (CLAUDE.md §6). Instances are recycled,
 * so this is a cost guard, not a hard quota.
 */

export type Limit = { max: number; windowMs: number };

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limits: Record<string, Limit>) {}

  /** Records a hit for every key; returns seconds to wait if any key is over its limit. */
  check(keys: Record<string, string>, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
    let wait = 0;
    for (const [kind, id] of Object.entries(keys)) {
      const limit = this.limits[kind];
      if (!limit) continue;
      const list = (this.hits.get(`${kind}:${id}`) ?? []).filter((t) => now - t < limit.windowMs);
      if (list.length >= limit.max) wait = Math.max(wait, Math.ceil((list[0]! + limit.windowMs - now) / 1000));
      this.hits.set(`${kind}:${id}`, list);
    }
    if (wait > 0) return { ok: false, retryAfterSec: wait };
    for (const [kind, id] of Object.entries(keys)) if (this.limits[kind]) this.hits.get(`${kind}:${id}`)!.push(now);
    if (this.hits.size > 50_000) this.prune(now);
    return { ok: true };
  }

  private prune(now: number): void {
    const longest = Math.max(...Object.values(this.limits).map((l) => l.windowMs));
    for (const [k, list] of this.hits) if (!list.length || now - list[list.length - 1]! > longest) this.hits.delete(k);
  }
}

export const DEFAULT_LIMITS: Record<string, Limit> = {
  device: { max: 10, windowMs: 10 * 60_000 },
  ip: { max: 40, windowMs: 60 * 60_000 },
};
