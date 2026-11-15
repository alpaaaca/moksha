package state

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPipelineWorkerStats(t *testing.T) {
	s, _ := openFile(t)

	term := s.Term()
	other := run("o1", RunCompleted)
	other.Name = "other"
	attempt := func(id, runID string, seq, n int, worker, status string, took time.Duration) StepAttempt {
		return StepAttempt{
			ID: id, RunID: runID, Seq: seq, Number: n, Term: term, WorkerID: worker, Status: status,
			DispatchedAt: t0, StartedAt: ptr(t0), FinishedAt: ptr(t0.Add(took)),
		}
	}
	task := func(id, runID string, n int, worker, status string) RunTask {
		return RunTask{
			ID: id, RunID: runID, Number: n, Term: term, WorkerID: worker, Status: status,
			QueuedAt: t0, DispatchedAt: ptr(t0), FinishedAt: ptr(t0.Add(time.Second)),
		}
	}
	noStart := attempt("a6", "h2", 1, 2, "w2", AttemptSucceeded, 0)
	noStart.StartedAt, noStart.FinishedAt = nil, ptr(t0.Add(2*time.Second)) // timed from dispatch

	put(t, s, []Event{{Type: EventRunFinished, Tenant: "t", RunID: "h1"}},
		func(tx *Tx) error { return tx.PutRun(run("h1", RunCompleted)) },
		func(tx *Tx) error { return tx.PutRun(run("h2", RunFailed)) },
		func(tx *Tx) error { return tx.PutRun(other) },
		func(tx *Tx) error { return tx.PutStep(step("h1", 1, StepCompleted)) },
		func(tx *Tx) error { return tx.PutStep(step("h1", 2, StepCompleted)) },
		func(tx *Tx) error { return tx.PutStep(step("h2", 1, StepFailed)) },
		func(tx *Tx) error { return tx.PutStep(step("o1", 1, StepCompleted)) },
		func(tx *Tx) error { return tx.PutRunTask(task("t1", "h1", 1, "w1", RunTaskCompleted)) },
		func(tx *Tx) error { return tx.PutRunTask(task("t2", "h2", 1, "w1", RunTaskLost)) },
		func(tx *Tx) error {
			return tx.PutStepAttempt(attempt("a1", "h1", 1, 1, "w1", AttemptSucceeded, time.Second))
		},
		func(tx *Tx) error { return tx.PutStepAttempt(attempt("a2", "h1", 2, 1, "w2", AttemptLost, 0)) },
		func(tx *Tx) error {
			return tx.PutStepAttempt(attempt("a3", "h1", 2, 2, "w2", AttemptSucceeded, 3*time.Second))
		},
		func(tx *Tx) error {
			return tx.PutStepAttempt(attempt("a4", "h2", 1, 1, "w2", AttemptFailed, time.Second))
		},
		func(tx *Tx) error { return tx.PutStepAttempt(noStart) },
		func(tx *Tx) error {
			return tx.PutStepAttempt(attempt("a5", "o1", 1, 1, "w3", AttemptSucceeded, time.Second))
		},
	)

	got, err := s.PipelineWorkerStats(ctx, "daily_revenue", 0)
	require.NoError(t, err)
	require.Len(t, got, 2) // w3 worked only for another pipeline; w2 did more than w1
	assert.Equal(t, WorkerStats{
		WorkerID: "w2", Runs: 2, Steps: 4, StepsSucceeded: 2, StepsFailed: 1, StepsLost: 1,
		StepMedian: 2 * time.Second, StepP95: 3 * time.Second, FirstAt: t0, LastAt: t0.Add(3 * time.Second),
	}, got[0])
	assert.Equal(t, WorkerStats{
		WorkerID: "w1", Runs: 2, Steps: 1, StepsSucceeded: 1, Replays: 2, ReplaysFailed: 1,
		StepMedian: time.Second, StepP95: time.Second, FirstAt: t0, LastAt: t0.Add(time.Second),
	}, got[1])

	// Only the newest run (h2).
	got, err = s.PipelineWorkerStats(ctx, "daily_revenue", 1)
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, []int{2, 1}, []int{got[0].Steps + got[0].Replays, got[1].Steps + got[1].Replays})
}

func TestPercentile(t *testing.T) {
	ds := []time.Duration{5, 1, 4, 2, 3}
	assert.Equal(t, time.Duration(3), percentile(ds, 50))
	assert.Equal(t, time.Duration(5), percentile(ds, 95))
	assert.Equal(t, time.Duration(0), percentile(nil, 50))
}
