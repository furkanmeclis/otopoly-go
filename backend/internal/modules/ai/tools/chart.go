package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// MaxChartRows caps rows per chart.
const MaxChartRows = 60

// RenderChart draws a chart in the chat. The model either passes the rows
// inline (data) or references an earlier tool result (source_tool_use_id +
// rows_path) so it does not have to re-emit the numbers as output tokens.
type RenderChart struct{}

var chartSchema = map[string]any{
	"type": "object",
	"properties": map[string]any{
		"type":  map[string]any{"type": "string", "enum": []string{"line", "bar", "area", "pie"}},
		"title": map[string]any{"type": "string", "minLength": 1, "maxLength": 120},
		"x_key": map[string]any{"type": "string", "minLength": 1, "maxLength": 64, "description": "Row key for the X axis / pie slice label (e.g. \"date\" or \"name\")."},
		"series": map[string]any{
			"type": "array", "minItems": 1, "maxItems": 6,
			"description": "Numeric row keys to plot with display labels. Pie charts use exactly one series.",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"key":   map[string]any{"type": "string", "minLength": 1, "maxLength": 64},
					"label": map[string]any{"type": "string", "maxLength": 60},
				},
				"required":             []string{"key"},
				"additionalProperties": false,
			},
		},
		"data": map[string]any{
			"type": "array", "maxItems": MaxChartRows,
			"description": "Inline rows (objects with x_key and series keys, numeric values). Omit when using source_tool_use_id.",
			"items":       map[string]any{"type": "object"},
		},
		"source_tool_use_id": map[string]any{"type": "string", "maxLength": 128, "description": "id of an earlier tool call in this conversation whose JSON result holds the rows."},
		"rows_path":          map[string]any{"type": "string", "maxLength": 64, "description": "Dot path to the array inside that result, e.g. \"timeseries\"."},
		"value_format":       map[string]any{"type": "string", "enum": []string{"currency", "number", "percent"}},
		"currency":           map[string]any{"type": "string", "maxLength": 3},
	},
	"required":             []string{"type", "title", "x_key", "series"},
	"additionalProperties": false,
}

// Spec implements Tool.
func (RenderChart) Spec() Spec {
	return Spec{
		Name:        "render_chart",
		Description: "Render a chart (line, bar, area or pie) in the chat for the user. Prefer referencing a previous tool result with source_tool_use_id + rows_path instead of repeating the data. Max 60 rows. After it returns \"rendered\", briefly describe the key takeaway in text; do not repeat the data as a table.",
		InputSchema: chartSchema,
		Feature:     FeatureCharts,
		Kind:        KindUI,
	}
}

// Run implements Tool.
func (RenderChart) Run(_ context.Context, env Env, raw json.RawMessage) (Result, error) {
	var in struct {
		Type   string `json:"type"`
		Title  string `json:"title"`
		XKey   string `json:"x_key"`
		Series []struct {
			Key   string `json:"key"`
			Label string `json:"label"`
		} `json:"series"`
		Data         []map[string]any `json:"data"`
		SourceToolID string           `json:"source_tool_use_id"`
		RowsPath     string           `json:"rows_path"`
		ValueFormat  string           `json:"value_format"`
		Currency     string           `json:"currency"`
	}
	if err := Decode(chartSchema, raw, &in); err != nil {
		return ErrorResult(err.Error()), nil
	}
	rows := in.Data
	if in.SourceToolID != "" {
		if len(rows) > 0 {
			return ErrorResult("pass either data or source_tool_use_id, not both"), nil
		}
		if env.LookupResult == nil {
			return ErrorResult("source_tool_use_id is not available"), nil
		}
		content, ok := env.LookupResult(in.SourceToolID)
		if !ok {
			return ErrorResult("no tool result found for source_tool_use_id " + in.SourceToolID), nil
		}
		extracted, err := extractRows(content, in.RowsPath)
		if err != nil {
			return ErrorResult(err.Error()), nil
		}
		rows = extracted
	}
	if len(rows) == 0 {
		return ErrorResult("no rows to chart"), nil
	}
	if len(rows) > MaxChartRows {
		rows = rows[:MaxChartRows]
	}
	if in.Type == "pie" && len(in.Series) != 1 {
		return ErrorResult("pie charts take exactly one series"), nil
	}
	chart := &Chart{Type: in.Type, Title: in.Title, XKey: in.XKey, ValueFormat: in.ValueFormat, Currency: strings.ToUpper(in.Currency)}
	for _, s := range in.Series {
		label := s.Label
		if label == "" {
			label = s.Key
		}
		chart.Series = append(chart.Series, ChartSeries{Key: s.Key, Label: label})
	}
	chart.Rows = make([]map[string]any, 0, len(rows))
	plotted := 0
	for _, r := range rows {
		x, ok := r[in.XKey]
		if !ok {
			continue
		}
		row := map[string]any{in.XKey: fmt.Sprint(x)}
		for _, s := range chart.Series {
			n, ok := toNumber(r[s.Key])
			if ok {
				plotted++
			}
			row[s.Key] = n
		}
		chart.Rows = append(chart.Rows, row)
	}
	if len(chart.Rows) == 0 {
		return ErrorResult(fmt.Sprintf("rows have no %q key", in.XKey)), nil
	}
	if plotted == 0 {
		return ErrorResult("series keys have no numeric values in the rows"), nil
	}
	return Result{
		Content:       "rendered",
		SummaryKey:    "ai.tool_summary.chart_rendered",
		SummaryParams: map[string]any{"title": in.Title},
		Chart:         chart,
	}, nil
}

func extractRows(content, path string) ([]map[string]any, error) {
	var v any
	if err := json.Unmarshal([]byte(content), &v); err != nil {
		return nil, fmt.Errorf("source tool result is not JSON")
	}
	if p := strings.TrimSpace(path); p != "" {
		for _, part := range strings.Split(p, ".") {
			obj, ok := v.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("rows_path %q not found", path)
			}
			v, ok = obj[part]
			if !ok {
				return nil, fmt.Errorf("rows_path %q not found", path)
			}
		}
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("rows_path must point to an array")
	}
	out := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out, nil
}

func toNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		s := strings.TrimSpace(n)
		s = strings.TrimLeft(s, "₺$€£")
		// Accept both "1234.5" and Turkish "1.234,50".
		if strings.Contains(s, ",") {
			s = strings.ReplaceAll(s, ".", "")
			s = strings.ReplaceAll(s, ",", ".")
		}
		fields := strings.Fields(s)
		if len(fields) == 0 {
			return 0, false
		}
		f, err := strconv.ParseFloat(fields[0], 64)
		return f, err == nil
	}
	return 0, false
}
