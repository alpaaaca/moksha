package cmd

import (
	"context"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
)

// exitOnStdinEOFEnv, set to 1, makes dev and server stop when their stdin
// reaches EOF, as on SIGTERM. A process that starts one with a pipe as its
// stdin and never writes to it (the Python SDK's tests) ties the server's
// life to its own: when that process dies, even by SIGKILL, the OS closes
// its end of the pipe and the server stops instead of running on orphaned.
// Off by default: dev started with stdin at EOF (</dev/null, nohup, a
// service manager) must keep running.
const exitOnStdinEOFEnv = "MOKSHA_EXIT_ON_STDIN_EOF"

// stopContext is done on Ctrl-C or SIGTERM, and when stdin reaches EOF if
// $MOKSHA_EXIT_ON_STDIN_EOF is 1.
func stopContext() (context.Context, context.CancelFunc) {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	if os.Getenv(exitOnStdinEOFEnv) == "1" {
		stopOnEOF(os.Stdin, stop)
	}
	return ctx, stop
}

// stopOnEOF calls stop once r reaches EOF or fails, discarding what it reads.
func stopOnEOF(r io.Reader, stop func()) {
	go func() {
		_, _ = io.Copy(io.Discard, r)
		slog.Info("stdin closed; stopping", "env", exitOnStdinEOFEnv)
		stop()
	}()
}
