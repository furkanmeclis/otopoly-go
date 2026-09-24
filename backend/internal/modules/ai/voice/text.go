package voice

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// ResolveTTS splits the stored TTS setting into a Speaches model id and voice.
//
// The setting is "<model>" or "<model>:<voice>" (Hugging Face repo ids never
// contain ':'). Piper repos are named piper-<lang>_<REGION>-<voice>-<quality>
// and carry exactly one voice, so the voice is derived from the repo name
// (Speaches ignores it for Piper anyway). Other models (e.g. Kokoro) need an
// explicit voice: "speaches-ai/Kokoro-82M-v1.0-ONNX:af_heart".
func ResolveTTS(setting string) (model, voice string) {
	setting = strings.TrimSpace(setting)
	if i := strings.LastIndex(setting, ":"); i > 0 {
		return strings.TrimSpace(setting[:i]), strings.TrimSpace(setting[i+1:])
	}
	model = setting
	repo := model[strings.LastIndex(model, "/")+1:]
	if parts := strings.Split(repo, "-"); len(parts) == 4 && parts[0] == "piper" {
		return model, parts[2]
	}
	return model, "default"
}

var (
	reCodeFence  = regexp.MustCompile("(?s)```.*?```")
	reInlineCode = regexp.MustCompile("`([^`]*)`")
	reImage      = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	reLink       = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	reHeading    = regexp.MustCompile(`(?m)^\s{0,3}#{1,6}\s*`)
	reQuote      = regexp.MustCompile(`(?m)^\s*>\s?`)
	reBullet     = regexp.MustCompile(`(?m)^\s*(?:[-*+]|\d+[.)])\s+`)
	reTableSep   = regexp.MustCompile(`(?m)^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$`)
	reRule       = regexp.MustCompile(`(?m)^\s*(?:[-*_]\s*){3,}$`)
	reEmphasis   = regexp.MustCompile(`(\*\*|__|\*|~~)([^*~\n]+?)(\*\*|__|\*|~~)`)
	reLira       = regexp.MustCompile(`₺\s?(\d(?:[\d.,]*\d)?)`)
	reSpaces     = regexp.MustCompile(`[ \t]+`)
	reBlankLines = regexp.MustCompile(`\n{2,}`)
)

// SpeakableText turns assistant Markdown into plain text for TTS: code,
// link targets, table syntax and emphasis markers are dropped, "₺1.250"
// becomes "1.250 TL" (Piper does not read the lira sign).
func SpeakableText(md string) string {
	s := strings.ReplaceAll(md, "\r\n", "\n")
	s = reCodeFence.ReplaceAllString(s, "")
	s = reImage.ReplaceAllString(s, "$1")
	s = reLink.ReplaceAllString(s, "$1")
	s = reInlineCode.ReplaceAllString(s, "$1")
	s = reTableSep.ReplaceAllString(s, "")
	s = reRule.ReplaceAllString(s, "")
	s = reHeading.ReplaceAllString(s, "")
	s = reQuote.ReplaceAllString(s, "")
	s = reBullet.ReplaceAllString(s, "")
	for i := 0; i < 2; i++ { // nested emphasis ("**_x_**")
		s = reEmphasis.ReplaceAllString(s, "$2")
	}
	s = reLira.ReplaceAllString(s, "$1 TL")
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "|") {
			// Table row: "| a | b |" → "a, b."
			var cells []string
			for _, c := range strings.Split(strings.Trim(line, "|"), "|") {
				if c = strings.TrimSpace(c); c != "" {
					cells = append(cells, c)
				}
			}
			line = strings.Join(cells, ", ")
			if line != "" && !strings.ContainsAny(line[len(line)-1:], ".!?:") {
				line += "."
			}
		}
		lines[i] = reSpaces.ReplaceAllString(line, " ")
	}
	s = strings.Join(lines, "\n")
	s = reBlankLines.ReplaceAllString(s, "\n")
	return strings.TrimSpace(s)
}

// Clip shortens text to at most max runes, preferring to cut at the end of
// a sentence (or line) in the last third of the window. It reports whether
// the text was shortened.
func Clip(s string, max int) (string, bool) {
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s, false
	}
	r := []rune(s)[:max]
	cut := -1
	for i := len(r) - 1; i >= max*2/3; i-- {
		if r[i] == '.' || r[i] == '!' || r[i] == '?' || r[i] == '\n' {
			cut = i + 1
			break
		}
	}
	if cut < 0 {
		for i := len(r) - 1; i >= max*2/3; i-- {
			if r[i] == ' ' {
				cut = i
				break
			}
		}
	}
	if cut < 0 {
		cut = len(r)
	}
	return strings.TrimSpace(string(r[:cut])), true
}
