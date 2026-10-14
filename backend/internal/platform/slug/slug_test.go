package slug

import "testing"

func TestFromName(t *testing.T) {
	cases := map[string]string{
		"Tek Oto Yıkama":          "tek-oto-yikama",
		"TechnoWıde":              "technowide",
		"İSTANBUL Şube Çağrı Ünü": "istanbul-sube-cagri-unu",
		"Göztepe Oto":             "goztepe-oto",
		"UMT Motors Garage":       "umt-motors-garage",
		"  --Café & Bar--  ":      "cafe-bar",
		"":                        "item",
		"!!!":                     "item",
	}
	for in, want := range cases {
		if got := FromName(in); got != want {
			t.Errorf("FromName(%q) = %q, want %q", in, got, want)
		}
	}
}
