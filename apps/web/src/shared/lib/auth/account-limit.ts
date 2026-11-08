import { createHash, randomUUID } from 'node:crypto';

export interface Queryable {
  query(text: string, values: unknown[]): Promise<{ rows: { count: number | string }[] }>;
}

export interface AccountLimit {
  windowSeconds: number;
  max: number;
}

/**
 * Counts sign-in attempts per account on top of Better Auth's per-IP limit, in its rateLimit
 * table so every serverless instance sees the same count. The email is stored only as a hash.
 */
export function createAccountLimiter(db: Queryable, limit: AccountLimit, now = Date.now) {
  return async function allow(email: string): Promise<boolean> {
    const key = `account:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
    const at = now();
    const windowStart = at - limit.windowSeconds * 1000;
    const { rows } = await db.query(
      `INSERT INTO "rateLimit" (id, key, count, "lastRequest") VALUES ($1, $2, 1, $3)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN "rateLimit"."lastRequest" <= $4 THEN 1 ELSE "rateLimit".count + 1 END,
         "lastRequest" = CASE WHEN "rateLimit"."lastRequest" <= $4 THEN $3
                              ELSE "rateLimit"."lastRequest" END
       RETURNING count`,
      [randomUUID(), key, at, windowStart],
    );
    return Number(rows[0]?.count ?? 0) <= limit.max;
  };
}
