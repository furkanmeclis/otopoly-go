package usecase

import "io"

const referenceAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func newReferenceCode(rand io.Reader) string {
	buf := make([]byte, 6)
	if rand != nil {
		_, _ = io.ReadFull(rand, buf)
	}
	out := make([]byte, 0, 10)
	out = append(out, "OTO-"...)
	for _, b := range buf {
		out = append(out, referenceAlphabet[int(b)%len(referenceAlphabet)])
	}
	return string(out)
}
