package usecase

import (
	"regexp"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/tools"
)

// PreviewChars caps the conversation list preview (runes, before "…").
const PreviewChars = 120

var (
	mdLink   = regexp.MustCompile(`!?\[([^\]]*)\]\([^)]*\)`)
	mdMarks  = regexp.MustCompile("[*_`#>~|]+")
	mdBullet = regexp.MustCompile(`(?m)^\s*(?:[-+]|\d+\.)\s+`)
	spaces   = regexp.MustCompile(`\s+`)
)

// messagePreview turns a chat text (markdown from the model, plain text
// from the user) into a short single-line plain-text preview.
func messagePreview(text string) string {
	text = mdLink.ReplaceAllString(text, "$1")
	text = mdBullet.ReplaceAllString(text, "")
	text = mdMarks.ReplaceAllString(text, "")
	text = spaces.ReplaceAllString(text, " ")
	return tools.Truncate(text, PreviewChars)
}

// lastUIText is the preview of the last non-empty text block of a turn
// ("" when the turn has none, e.g. only tool activity or an error).
func lastUIText(ui []UIBlock) string {
	for i := len(ui) - 1; i >= 0; i-- {
		if ui[i].Type == UIText && strings.TrimSpace(ui[i].Text) != "" {
			return messagePreview(ui[i].Text)
		}
	}
	return ""
}
