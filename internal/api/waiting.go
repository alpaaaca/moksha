package api

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	mokshav1 "github.com/alper/moksha/internal/api/gen/moksha/v1"
	"github.com/alper/moksha/internal/core"
)

// WaitingText tells why a run's work waits, in plain words (pipeline, step,
// not run, step), with what to do about it. It starts lowercase: callers
// put "waiting: " or the like in front.
func WaitingText(w core.Waiting) string {
	what := "the pipeline's code"
	if w.Kind == core.TaskStep {
		what = fmt.Sprintf("step %s", w.Name)
	}
	withPool, onQueue := "", ""
	if w.Queue != core.DefaultQueue {
		withPool, onQueue = fmt.Sprintf(" with a pool on queue %s", w.Queue), fmt.Sprintf(" on queue %q", w.Queue)
	}
	switch w.Reason {
	case core.WaitNoWorker:
		return fmt.Sprintf("no worker is connected%s to run %s. Deploy its project%s: `moksha dev` in its directory, "+
			"or `moksha deploy`", onQueue, what, withPool)
	case core.WaitNoBuild:
		defines := fmt.Sprintf("pipeline %s", w.Name)
		if w.Kind == core.TaskStep {
			defines = fmt.Sprintf("step %s", w.Name)
		}
		return fmt.Sprintf("%s connected%s, but %s code doesn't define %s (build %s). "+
			"Restart a worker with code that has it", workersAre(w.Workers), onQueue, theirIts(w.Workers), defines,
			strings.Join(shortBuilds(w.Builds), ", "))
	case core.WaitStarting:
		return fmt.Sprintf("a worker is starting in pool %s to run %s", w.Pool, what)
	case core.WaitQueueLimit:
		return fmt.Sprintf("%s waits for a free slot: queue %q runs as many steps at once as it may", what, w.Queue)
	default:
		return fmt.Sprintf("%s waits for a free worker: the workers that can run it are busy", what)
	}
}

func workersAre(n int) string {
	if n == 1 {
		return "1 worker is"
	}
	return fmt.Sprintf("%d workers are", n)
}

func theirIts(n int) string {
	if n == 1 {
		return "its"
	}
	return "their"
}

func shortBuilds(builds []string) []string {
	out := make([]string, len(builds))
	for i, b := range builds {
		switch {
		case b == "":
			out[i] = "none"
		case len(b) > 12:
			out[i] = b[:12]
		default:
			out[i] = b
		}
	}
	return out
}

func waitingMessage(w core.Waiting) *mokshav1.Waiting {
	return &mokshav1.Waiting{Reason: string(w.Reason), Message: WaitingText(w), Kind: string(w.Kind), Name: w.Name,
		Seq: int32(w.Seq), Queue: w.Queue, Since: timestamppb.New(w.Since), Workers: int32(w.Workers), Builds: w.Builds, Pool: w.Pool}
}

// addWaiting sets what the running ones among runs wait for, if they do:
// signals, and workers (with why).
func (s *RunServer) addWaiting(ctx context.Context, runs ...*mokshav1.Run) error {
	var ids []string
	for _, h := range runs {
		if h.Status == "running" {
			ids = append(ids, h.Id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	ws, err := s.core.Waiting(ctx, ids)
	if err != nil {
		return err
	}
	signals, err := s.core.SignalWaits(ctx, ids)
	if err != nil {
		return err
	}
	for _, h := range runs {
		for _, w := range signals[h.Id] {
			m := &mokshav1.SignalWait{Seq: int32(w.Seq), Name: w.Name}
			if !w.TimesOutAt.IsZero() {
				m.TimesOutAt = timestamppb.New(w.TimesOutAt)
			}
			h.SignalWaits = append(h.SignalWaits, m)
		}
		if w, ok := ws[h.Id]; ok {
			h.Waiting = waitingMessage(w)
		}
	}
	return nil
}

func (s *RunServer) ListWorkers(ctx context.Context, _ *connect.Request[mokshav1.ListWorkersRequest]) (*connect.Response[mokshav1.ListWorkersResponse], error) {
	ws, err := s.core.Workers(ctx)
	if err != nil {
		return nil, connectError(err)
	}
	out := &mokshav1.ListWorkersResponse{}
	for _, w := range ws {
		m := &mokshav1.Worker{Id: w.ID, BuildId: w.BuildID, Queues: w.Queues, LastSeen: timestamppb.New(w.LastSeen), Polling: w.Polling,
			Running: int32(w.Running)}
		for _, k := range w.Kinds {
			m.Kinds = append(m.Kinds, string(k))
		}
		out.Workers = append(out.Workers, m)
	}
	return connect.NewResponse(out), nil
}

func (s *RunServer) ListPools(ctx context.Context, _ *connect.Request[mokshav1.ListPoolsRequest]) (*connect.Response[mokshav1.ListPoolsResponse], error) {
	ps, err := s.core.Pools(ctx)
	if err != nil {
		return nil, connectError(err)
	}
	out := &mokshav1.ListPoolsResponse{}
	for _, p := range ps {
		m := &mokshav1.Pool{Name: p.Name, Queues: p.Queues, Min: int32(p.Min), Max: int32(p.Max), Workers: p.Workers,
			Starting: int32(p.Starting), Decision: p.Decision, Desired: int32(p.Desired), External: p.External}
		if !p.DecidedAt.IsZero() {
			m.DecidedAt = timestamppb.New(p.DecidedAt)
		}
		out.Pools = append(out.Pools, m)
	}
	return connect.NewResponse(out), nil
}

func (s *RunServer) GetPipelineWorkers(ctx context.Context, req *connect.Request[mokshav1.GetPipelineWorkersRequest]) (*connect.Response[mokshav1.GetPipelineWorkersResponse], error) {
	m := req.Msg
	if m.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name: required"))
	}
	if m.Runs > 1000 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("runs %d: at most 1000", m.Runs))
	}
	ws, err := s.store.PipelineWorkerStats(ctx, m.Name, int(m.Runs))
	if err != nil {
		return nil, connectError(err)
	}
	out := &mokshav1.GetPipelineWorkersResponse{}
	for _, w := range ws {
		pw := &mokshav1.PipelineWorker{
			WorkerId: w.WorkerID, Runs: int32(w.Runs), Steps: int32(w.Steps), StepsSucceeded: int32(w.StepsSucceeded),
			StepsFailed: int32(w.StepsFailed), StepsLost: int32(w.StepsLost), StepsCancelled: int32(w.StepsCancelled),
			Replays: int32(w.Replays), ReplaysFailed: int32(w.ReplaysFailed),
			FirstAt: timestamppb.New(w.FirstAt), LastAt: timestamppb.New(w.LastAt),
		}
		if w.StepsSucceeded > 0 {
			pw.StepMedian, pw.StepP95 = durationpb.New(w.StepMedian), durationpb.New(w.StepP95)
		}
		out.Workers = append(out.Workers, pw)
	}
	return connect.NewResponse(out), nil
}
