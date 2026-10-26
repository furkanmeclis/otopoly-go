package sms

import (
	"strings"
	"unicode/utf16"
)

// Encodings reported by Estimate.
const (
	EncodingGSM7    = "gsm7"
	EncodingTurkish = "turkish"
	EncodingUCS2    = "ucs2"
)

// gsmBasic is the GSM 03.38 default alphabet (one septet each).
const gsmBasic = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
	"¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

// gsmExtended needs an escape septet (two septets each).
const gsmExtended = "^{}\\[~]|€\f"

// turkishOnly are the Turkish letters outside the GSM default alphabet. With
// Netgsm's Turkish encoding (encoding=TR) they cost one character each.
const turkishOnly = "çğĞıİşŞ"

// Segments is a length / part estimate of one SMS text.
type Segments struct {
	Encoding string `json:"encoding"`
	// Characters is the billed length (extended GSM characters count twice,
	// UCS-2 counts UTF-16 units).
	Characters int `json:"characters"`
	Segments   int `json:"segments"`
	// PerSegment is the part size used (single message size when Segments is 1).
	PerSegment int `json:"per_segment"`
	// Remaining characters before the next part starts.
	Remaining int `json:"remaining"`
}

// part sizes: single, concatenated.
var partSizes = map[string][2]int{
	EncodingGSM7:    {160, 153},
	EncodingTurkish: {155, 150},
	EncodingUCS2:    {70, 67},
}

// Estimate counts characters and parts for a provider. Netgsm sends Turkish
// letters with its Turkish encoding; other providers (Twilio) fall back to
// UCS-2 for them, which shortens a part to 70 characters.
func Estimate(body, provider string) Segments {
	enc := EncodingGSM7
	chars := 0
	for _, r := range body {
		switch {
		case strings.ContainsRune(gsmBasic, r):
			chars++
		case strings.ContainsRune(gsmExtended, r):
			chars += 2
		case strings.ContainsRune(turkishOnly, r) && provider == ProviderNetgsm:
			if enc == EncodingGSM7 {
				enc = EncodingTurkish
			}
			chars++
		default:
			enc = EncodingUCS2
		}
	}
	if enc == EncodingUCS2 {
		chars = len(utf16.Encode([]rune(body)))
	}
	sizes := partSizes[enc]
	out := Segments{Encoding: enc, Characters: chars}
	switch {
	case chars == 0:
		out.Segments, out.PerSegment, out.Remaining = 0, sizes[0], sizes[0]
	case chars <= sizes[0]:
		out.Segments, out.PerSegment, out.Remaining = 1, sizes[0], sizes[0]-chars
	default:
		out.PerSegment = sizes[1]
		out.Segments = (chars + sizes[1] - 1) / sizes[1]
		out.Remaining = out.Segments*sizes[1] - chars
	}
	return out
}

// HasTurkish reports whether body contains Turkish letters outside GSM 03.38.
func HasTurkish(body string) bool {
	return strings.ContainsAny(body, turkishOnly)
}
