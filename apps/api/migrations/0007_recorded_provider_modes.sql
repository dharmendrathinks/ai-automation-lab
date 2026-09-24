-- Preserve the existing mode field; do not relabel historical jobs from runtime configuration.
ALTER TABLE automation_runs DROP CONSTRAINT automation_runs_mode_check;
ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_mode_check
  CHECK (mode IN ('FIXTURE MODE', 'LIVE AI MODE'));

UPDATE automation_runs AS r
SET mode = CASE WHEN j.provider = 'codex' THEN 'LIVE AI MODE' ELSE 'FIXTURE MODE' END
FROM ai_jobs AS j
WHERE j.run_id = r.id AND j.task = 'triage' AND j.provider IN ('codex', 'fixture');
