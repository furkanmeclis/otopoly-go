package slug

import (
	"regexp"
	"strings"
)

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// transliterate maps Turkish and common Latin letters to ASCII so they are
// kept in the slug instead of being collapsed into a dash ("Yıkama" →
// "yikama", not "y-kama"). Applied before lowercasing so "İ" does not turn
// into "i" + combining dot.
var transliterate = strings.NewReplacer(
	"ç", "c", "Ç", "c",
	"ğ", "g", "Ğ", "g",
	"ı", "i", "I", "i", "İ", "i",
	"ö", "o", "Ö", "o",
	"ş", "s", "Ş", "s",
	"ü", "u", "Ü", "u",
	"â", "a", "Â", "a",
	"î", "i", "Î", "i",
	"û", "u", "Û", "u",
	"ä", "a", "Ä", "a",
	"é", "e", "É", "e",
	"è", "e", "È", "e",
	"ß", "ss",
)

// FromName turns a display name into a URL-safe ASCII slug.
func FromName(name string) string {
	name = strings.TrimSpace(strings.ToLower(transliterate.Replace(name)))
	if name == "" {
		return "item"
	}
	slug := nonSlug.ReplaceAllString(name, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "item"
	}
	if len(slug) > 80 {
		slug = strings.Trim(slug[:80], "-")
	}
	return slug
}
