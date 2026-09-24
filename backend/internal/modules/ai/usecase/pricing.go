package usecase

import (
	"math"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
)

// modelPrice is USD per million tokens. Cache writes are billed at 1.25x input
// (5-minute TTL); CacheRead is the per-MTok cache read price.
type modelPrice struct {
	prefix    string
	input     float64
	output    float64
	cacheRead float64
}

// Ordered longest-prefix first. Estimates only — the provider invoice is authoritative.
var modelPrices = []modelPrice{
	{"claude-fable-5-1", 10, 50, 0.25},
	{"claude-mythos-5-1", 10, 50, 0.25},
	{"claude-fable-5", 10, 50, 1},
	{"claude-mythos-5", 10, 50, 1},
	{"claude-opus-5-5", 4, 20, 0.20},
	{"claude-opus-5", 5, 25, 0.50},
	{"claude-opus-4-8", 5, 25, 0.50},
	{"claude-opus-4-7", 5, 25, 0.50},
	{"claude-opus-4-6", 5, 25, 0.50},
	{"claude-opus-4-5", 5, 25, 0.50},
	{"claude-opus-4-1", 15, 75, 1.50},
	{"claude-opus-4", 15, 75, 1.50},
	{"claude-sonnet-5", 2, 10, 0.20},
	{"claude-sonnet-4", 3, 15, 0.30},
	{"claude-haiku-4-5", 1, 5, 0.10},
}

// EstimateCostUSD returns the estimated cost of usage for a model; false when
// the model has no known price (e.g. self-hosted open models).
func EstimateCostUSD(model string, u provider.Usage) (float64, bool) {
	m := strings.ToLower(strings.TrimSpace(model))
	for _, p := range modelPrices {
		if strings.HasPrefix(m, p.prefix) {
			cost := float64(u.InputTokens)*p.input +
				float64(u.OutputTokens)*p.output +
				float64(u.CacheWriteTokens)*p.input*1.25 +
				float64(u.CacheReadTokens)*p.cacheRead
			return cost / 1_000_000, true
		}
	}
	return 0, false
}

func roundCost(v float64) float64 { return math.Round(v*10000) / 10000 }
