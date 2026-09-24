package voice

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestResolveTTS(t *testing.T) {
	cases := []struct{ in, model, voice string }{
		{"speaches-ai/piper-tr_TR-fettah-medium", "speaches-ai/piper-tr_TR-fettah-medium", "fettah"},
		{"speaches-ai/piper-tr_TR-dfki-medium", "speaches-ai/piper-tr_TR-dfki-medium", "dfki"},
		{"speaches-ai/Kokoro-82M-v1.0-ONNX:af_heart", "speaches-ai/Kokoro-82M-v1.0-ONNX", "af_heart"},
		{" custom/model ", "custom/model", "default"},
	}
	for _, c := range cases {
		m, v := ResolveTTS(c.in)
		if m != c.model || v != c.voice {
			t.Errorf("ResolveTTS(%q) = %q, %q; want %q, %q", c.in, m, v, c.model, c.voice)
		}
	}
}

func TestSpeakableText(t *testing.T) {
	md := "## Bugünkü özet\n\n" +
		"Bugün **3 araç** teslim edildi, toplam _tahsilat_ ₺12.500,00.\n\n" +
		"- Seramik kaplama\n- [İş emri](/t/demo/jobs/1)\n\n" +
		"| Müşteri | Tutar |\n|---|---:|\n| Hüseyin Ülken | ₺20.000 |\n\n" +
		"```json\n{\"a\":1}\n```\n" +
		"Plaka `34 ABC 123` hazır."
	got := SpeakableText(md)
	want := "Bugünkü özet\n" +
		"Bugün 3 araç teslim edildi, toplam _tahsilat_ 12.500,00 TL.\n" +
		"Seramik kaplama\nİş emri\n" +
		"Müşteri, Tutar.\nHüseyin Ülken, 20.000 TL.\n" +
		"Plaka 34 ABC 123 hazır."
	if got != want {
		t.Fatalf("SpeakableText:\n%s\n--- want ---\n%s", got, want)
	}
	if SpeakableText("tr_TR-x_y **kalın**") != "tr_TR-x_y kalın" {
		t.Fatalf("underscores in words must survive: %q", SpeakableText("tr_TR-x_y **kalın**"))
	}
}

func TestClip(t *testing.T) {
	if s, cut := Clip("kısa", 10); s != "kısa" || cut {
		t.Fatalf("Clip short = %q %v", s, cut)
	}
	long := strings.Repeat("Bir cümle burada. ", 20)
	s, cut := Clip(long, 100)
	if !cut || utf8.RuneCountInString(s) > 100 || !strings.HasSuffix(s, ".") {
		t.Fatalf("Clip long = %q %v", s, cut)
	}
	s, _ = Clip(strings.Repeat("ğ", 50), 10)
	if utf8.RuneCountInString(s) != 10 {
		t.Fatalf("Clip runes = %q", s)
	}
}
