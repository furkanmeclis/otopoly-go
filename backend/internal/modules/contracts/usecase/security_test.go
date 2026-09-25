package usecase

import (
	"strings"
	"testing"
)

func TestSniffContractMedia(t *testing.T) {
	cases := []struct {
		name string
		body []byte
		ok   bool
		ct   string
	}{
		{"png", []byte("\x89PNG\r\n\x1a\n0000"), true, "image/png"},
		{"jpeg", []byte("\xff\xd8\xff\xe0000000"), true, "image/jpeg"},
		{"pdf", []byte("%PDF-1.7\n..."), true, "application/pdf"},
		{"html", []byte("<html><script>alert(1)</script></html>"), false, ""},
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`), false, ""},
		{"text", []byte("hello"), false, ""},
	}
	for _, tc := range cases {
		ct, _, ok := sniffContractMedia(tc.body)
		if ok != tc.ok || ct != tc.ct {
			t.Fatalf("%s: got (%q,%v) want (%q,%v)", tc.name, ct, ok, tc.ct, tc.ok)
		}
	}
}

func TestBuildContractHTMLStripsActiveContent(t *testing.T) {
	out := buildContractHTML(contractPDFOptions{
		Title: "T",
		ContentHTML: `<p>ok</p><iframe src="file:///etc/passwd"></iframe>` +
			`<META http-equiv="refresh" content="0;url=http://169.254.169.254/">` +
			`<script>fetch('http://internal')</script><base href="http://evil/">` +
			`<object data="http://internal"></object><link rel=stylesheet href=http://x>`,
	})
	for _, bad := range []string{"<iframe", "file:///etc/passwd", "169.254.169.254", "<script", "fetch(", "<base", "<object", "<link", "http://evil"} {
		if strings.Contains(strings.ToLower(out), strings.ToLower(bad)) {
			t.Fatalf("rendered HTML still contains %q", bad)
		}
	}
	if !strings.Contains(out, "<p>ok</p>") {
		t.Fatal("benign content was removed")
	}
	if !strings.Contains(out, "Content-Security-Policy") {
		t.Fatal("CSP meta missing")
	}
}
