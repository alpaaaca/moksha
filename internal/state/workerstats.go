package state

import (
	"context"
	"database/sql"
	"slices"
	"sort"
	"time"
)

// WorkerStats is what one worker did for a pipeline's recent runs: the step
// attempts and replays (run tasks) it took, how they ended, and how long its
// steps ran. A worker is its ID: a pool's workers are <pool>-<n> and keep
// it when restarted; one run by hand is <hostname>-<pid> by default, a new
// one each start.
type WorkerStats struct {
	WorkerID string
	Runs     int // distinct runs it worked on

	Steps          int // step attempts it took
	StepsSucceeded int
	StepsFailed    int
	StepsLost      int
	StepsCancelled int

	Replays       int // run tasks it took
	ReplaysFailed int // failed or lost

	// Of its succeeded step attempts, from started (or, without a start
	// reported, from taken) to finished; zero without one.
	StepMedian, StepP95 time.Duration

	FirstAt, LastAt time.Time
}

// PipelineWorkerStats returns, for the newest runs runs of the pipeline
// name (any tenant), what each worker did for them: busiest first. Reused
// steps took no worker and don't count.
func (s *Store) PipelineWorkerStats(ctx context.Context, name string, runs int) ([]WorkerStats, error) {
	if runs <= 0 {
		runs = 100
	}
	rows, err := s.r.QueryContext(ctx, `
		WITH recent AS (SELECT id FROM runs WHERE name = ? ORDER BY id DESC LIMIT ?)
		SELECT 'step', a.worker_id, a.run_id, a.status, a.dispatched_at, a.started_at, a.finished_at
		FROM step_attempts a JOIN recent r ON r.id = a.run_id WHERE a.worker_id != ''
		UNION ALL
		SELECT 'run', t.worker_id, t.run_id, t.status, t.dispatched_at, NULL, t.finished_at
		FROM run_tasks t JOIN recent r ON r.id = t.run_id WHERE t.worker_id != '' AND t.dispatched_at IS NOT NULL`,
		name, runs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type acc struct {
		WorkerStats
		runs  map[string]bool
		times []time.Duration
	}
	by := map[string]*acc{}
	for rows.Next() {
		var (
			kind, worker, runID, status string
			dispatched                  sql.NullString
			started, finished           sql.NullString
		)
		if err := rows.Scan(&kind, &worker, &runID, &status, &dispatched, &started, &finished); err != nil {
			return nil, err
		}
		a := by[worker]
		if a == nil {
			a = &acc{WorkerStats: WorkerStats{WorkerID: worker}, runs: map[string]bool{}}
			by[worker] = a
		}
		a.runs[runID] = true
		at, err := parseTimePtr(dispatched)
		if err != nil {
			return nil, err
		}
		st, err := parseTimePtr(started)
		if err != nil {
			return nil, err
		}
		fin, err := parseTimePtr(finished)
		if err != nil {
			return nil, err
		}
		for _, t := range []*time.Time{at, fin} {
			if t == nil {
				continue
			}
			if a.FirstAt.IsZero() || t.Before(a.FirstAt) {
				a.FirstAt = *t
			}
			if t.After(a.LastAt) {
				a.LastAt = *t
			}
		}
		if kind == "run" {
			a.Replays++
			if status == RunTaskFailed || status == RunTaskLost {
				a.ReplaysFailed++
			}
			continue
		}
		a.Steps++
		switch status {
		case AttemptSucceeded:
			a.StepsSucceeded++
			// Workers needn't report a start: a step starts when its worker
			// takes it.
			if st == nil {
				st = at
			}
			if st != nil && fin != nil {
				a.times = append(a.times, fin.Sub(*st))
			}
		case AttemptFailed:
			a.StepsFailed++
		case AttemptLost:
			a.StepsLost++
		case AttemptCancelled:
			a.StepsCancelled++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]WorkerStats, 0, len(by))
	for _, a := range by {
		a.Runs = len(a.runs)
		a.StepMedian, a.StepP95 = percentile(a.times, 50), percentile(a.times, 95)
		out = append(out, a.WorkerStats)
	}
	sort.Slice(out, func(i, j int) bool {
		if wi, wj := out[i].Steps+out[i].Replays, out[j].Steps+out[j].Replays; wi != wj {
			return wi > wj
		}
		return out[i].WorkerID < out[j].WorkerID
	})
	return out, nil
}

// percentile is the nearest-rank p-th percentile of ds; zero if empty.
func percentile(ds []time.Duration, p int) time.Duration {
	if len(ds) == 0 {
		return 0
	}
	ds = slices.Clone(ds)
	slices.Sort(ds)
	i := (p*len(ds) + 99) / 100 // ceil(p/100 * n)
	return ds[max(i-1, 0)]
}
