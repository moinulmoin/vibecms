export type AnalyticsGranularity = "day" | "month";
export type AnalyticsRollupKind = "page" | "post" | "referrer" | "crawler";

export type AnalyticsRollupValue = {
  kind: AnalyticsRollupKind;
  dimension: string;
  label: string | null;
  value: number;
};

export type AnalyticsRollupRecord = AnalyticsRollupValue & {
  granularity: AnalyticsGranularity;
  periodStart: string;
};

export type AnalyticsSite = { id: string; slug: string };

type RollupRow = {
  granularity: AnalyticsGranularity;
  period_start: string;
  kind: AnalyticsRollupKind;
  dimension: string;
  label: string | null;
  value: number;
};

type SiteRow = { id: string; slug: string };
type DateRow = { last_rolled_date: string | null };
type MonthRow = { site_id: string; month: string };
type HostRow = { hostname: string };

const INSERT_CHUNK_SIZE = 75;

function asRecord(row: RollupRow): AnalyticsRollupRecord {
  return {
    granularity: row.granularity,
    periodStart: row.period_start,
    kind: row.kind,
    dimension: row.dimension,
    label: row.label,
    value: Number(row.value),
  };
}

export interface AnalyticsRepository {
  listActiveSites(): Promise<AnalyticsSite[]>;
  listActiveCustomHosts(siteId: string): Promise<string[]>;
  getLastRolledDate(siteId: string): Promise<string | null>;
  replaceDaily(siteId: string, date: string, values: AnalyticsRollupValue[]): Promise<void>;
  listDaily(siteId: string, from: string, to: string): Promise<AnalyticsRollupRecord[]>;
  listMonthly(siteId: string, fromMonth?: string, toMonth?: string): Promise<AnalyticsRollupRecord[]>;
  compactDailyBefore(cutoffDate: string): Promise<number>;
}

export function createAnalyticsRepository(db: D1Database): AnalyticsRepository {
  return {
    async listActiveSites() {
      const result = await db.prepare(
        `SELECT s.id, s.slug
         FROM sites s
         INNER JOIN billing_customers b ON b.workspace_id = s.workspace_id
         WHERE s.status = 'active' AND b.status = 'active'
         ORDER BY s.id`,
      ).all<SiteRow>();
      return result.results ?? [];
    },

    async listActiveCustomHosts(siteId) {
      const result = await db.prepare(
        `SELECT hostname FROM domains
         WHERE site_id = ? AND type = 'custom' AND status = 'active'
         ORDER BY hostname`,
      ).bind(siteId).all<HostRow>();
      return (result.results ?? []).map((row) => row.hostname);
    },

    async getLastRolledDate(siteId) {
      const row = await db.prepare(
        `SELECT last_rolled_date FROM analytics_rollup_state WHERE site_id = ?`,
      ).bind(siteId).first<DateRow>();
      return row?.last_rolled_date ?? null;
    },

    async replaceDaily(siteId, date, values) {
      const now = Math.floor(Date.now() / 1000);
      const inserts = values
        .filter((value) => Number.isFinite(value.value) && value.value > 0)
        .map((value) => db.prepare(
          `INSERT INTO analytics_rollups
             (id, site_id, granularity, period_start, kind, dimension, label, value, created_at, updated_at)
           VALUES (?, ?, 'day', ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          siteId,
          date,
          value.kind,
          value.dimension,
          value.label,
          Math.round(value.value),
          now,
          now,
        ));

      const firstChunk = inserts.splice(0, INSERT_CHUNK_SIZE - 1);
      await db.batch([
        db.prepare(
          `DELETE FROM analytics_rollups
           WHERE site_id = ? AND granularity = 'day' AND period_start = ?`,
        ).bind(siteId, date),
        ...firstChunk,
      ]);
      while (inserts.length > 0) {
        await db.batch(inserts.splice(0, INSERT_CHUNK_SIZE));
      }
      await db.prepare(
        `INSERT INTO analytics_rollup_state (site_id, last_rolled_date, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(site_id) DO UPDATE SET
           last_rolled_date = CASE
             WHEN last_rolled_date IS NULL OR last_rolled_date < excluded.last_rolled_date
               THEN excluded.last_rolled_date
             ELSE last_rolled_date
           END,
           updated_at = excluded.updated_at`,
      ).bind(siteId, date, now, now).run();
    },

    async listDaily(siteId, from, to) {
      const result = await db.prepare(
        `SELECT granularity, period_start, kind, dimension, label, value
         FROM analytics_rollups
         WHERE site_id = ? AND granularity = 'day' AND period_start >= ? AND period_start <= ?
         ORDER BY period_start`,
      ).bind(siteId, from, to).all<RollupRow>();
      return (result.results ?? []).map(asRecord);
    },

    async listMonthly(siteId, fromMonth, toMonth) {
      const clauses = ["site_id = ?", "granularity = 'month'"];
      const bindings: string[] = [siteId];
      if (fromMonth) {
        clauses.push("period_start >= ?");
        bindings.push(fromMonth);
      }
      if (toMonth) {
        clauses.push("period_start <= ?");
        bindings.push(toMonth);
      }
      const result = await db.prepare(
        `SELECT granularity, period_start, kind, dimension, label, value
         FROM analytics_rollups
         WHERE ${clauses.join(" AND ")}
         ORDER BY period_start`,
      ).bind(...bindings).all<RollupRow>();
      return (result.results ?? []).map(asRecord);
    },

    async compactDailyBefore(cutoffDate) {
      const result = await db.prepare(
        `SELECT DISTINCT site_id, substr(period_start, 1, 7) AS month
         FROM analytics_rollups
         WHERE granularity = 'day'
           AND date(substr(period_start, 1, 7) || '-01', '+1 month') <= date(?)
         ORDER BY site_id, month`,
      ).bind(cutoffDate).all<MonthRow>();
      const siteMonths = result.results ?? [];
      const now = Math.floor(Date.now() / 1000);
      for (const { site_id: siteId, month } of siteMonths) {
        await db.batch([
          db.prepare(
            `DELETE FROM analytics_rollups
             WHERE site_id = ? AND granularity = 'month' AND period_start = ?`,
          ).bind(siteId, month),
          db.prepare(
            `INSERT INTO analytics_rollups
               (id, site_id, granularity, period_start, kind, dimension, label, value, created_at, updated_at)
             SELECT lower(hex(randomblob(16))), site_id, 'month', ?, kind, dimension, MAX(label), SUM(value), ?, ?
             FROM analytics_rollups
             WHERE site_id = ? AND granularity = 'day' AND substr(period_start, 1, 7) = ?
             GROUP BY site_id, kind, dimension`,
          ).bind(month, now, now, siteId, month),
          db.prepare(
            `DELETE FROM analytics_rollups
             WHERE site_id = ? AND granularity = 'day' AND substr(period_start, 1, 7) = ?`,
          ).bind(siteId, month),
        ]);
      }
      return siteMonths.length;
    },
  };
}
