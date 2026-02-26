/**
 * D1 SQL schema for metrics table
 * Stores bouncer request metrics for analytics
 */
export const METRICS_SQL = `
CREATE TABLE IF NOT EXISTS metrics (
  val INTEGER DEFAULT 1,
  metric_name TEXT,
  origin TEXT NOT NULL DEFAULT '',
  remediation_type TEXT NOT NULL DEFAULT '',
  ip_type TEXT NOT NULL DEFAULT '',
  UNIQUE(metric_name, origin, remediation_type, ip_type)
);
`;
