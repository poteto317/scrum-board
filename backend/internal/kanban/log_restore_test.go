package kanban

import (
	"bytes"
	"log"
	"testing"
)

func TestLogOutputIsRestoredAfterCapture(t *testing.T) {
	var before bytes.Buffer
	original, flags := log.Writer(), log.Flags()
	t.Cleanup(func() { // this test must not leave the standard logger redirected either
		log.SetOutput(original)
		log.SetFlags(flags)
	})
	log.SetOutput(&before)
	t.Run("capture", func(t *testing.T) { captureLogs(t) })
	if log.Writer() != &before || log.Flags() != flags {
		t.Fatal("captureLogs must restore the standard log output and flags")
	}
}
