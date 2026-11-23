-- Loops: pipelines that run until stopped, continuing as new. A build says
-- which of its pipelines can; for builds of older SDKs, which don't say, a
-- run that continued since the build registered shows it.
ALTER TABLE build_pipelines ADD COLUMN loops INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_runs_continued ON runs(name, created_at) WHERE status = 'continued';
