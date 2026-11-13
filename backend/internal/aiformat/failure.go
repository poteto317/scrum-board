package aiformat

import (
	"context"
	"errors"
	"net"

	"github.com/anthropics/anthropic-sdk-go/v2"
)

// Failure kinds, also what the server logs. Upstream text never becomes part of a Failure.
const (
	kindAuth          = "auth"
	kindRateLimit     = "rate_limit"
	kindTimeout       = "timeout"
	kindConnect       = "connect"
	kindServer        = "server"
	kindInvalidReq    = "invalid_request"
	kindRefusal       = "refusal"
	kindTruncated     = "truncated"
	kindInvalidOutput = "invalid_output"
)

// Failure reports why formatting failed without carrying any upstream text.
type Failure struct {
	Kind   string
	Status int
}

func (f *Failure) Error() string       { return "ai formatting failed: " + f.Kind }
func (f *Failure) FailureKind() string { return f.Kind }
func (f *Failure) UpstreamStatus() int { return f.Status }

// classify maps an SDK error to a Failure. The original error is dropped on purpose: its text can hold the request URL and the response body.
func classify(err error) *Failure {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return &Failure{Kind: kindTimeout}
	}
	var api *anthropic.Error
	if errors.As(err, &api) {
		status := api.StatusCode
		switch {
		case status == 401 || status == 403:
			return &Failure{Kind: kindAuth, Status: status}
		case status == 429:
			return &Failure{Kind: kindRateLimit, Status: status}
		case status >= 500:
			return &Failure{Kind: kindServer, Status: status}
		default:
			return &Failure{Kind: kindInvalidReq, Status: status}
		}
	}
	var network net.Error
	if errors.As(err, &network) {
		return &Failure{Kind: kindConnect}
	}
	return &Failure{Kind: kindInvalidOutput}
}
