package cmd

import (
	"io"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Writes to stdin don't stop the server; its closing does.
func TestStopOnEOF(t *testing.T) {
	r, w := io.Pipe()
	stopped := make(chan struct{})
	stopOnEOF(r, func() { close(stopped) })

	_, err := w.Write([]byte("anything\n"))
	require.NoError(t, err)
	select {
	case <-stopped:
		t.Fatal("stopped before EOF")
	case <-time.After(50 * time.Millisecond):
	}

	require.NoError(t, w.Close())
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		assert.Fail(t, "didn't stop at EOF")
	}
}
