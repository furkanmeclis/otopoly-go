package usecase

import (
	"strings"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/ai/provider"
)

func TestMessagePreviewIsPlainShortText(t *testing.T) {
	cases := map[string]string{
		"**Merhaba**,\n\n# Özet\n- bir\n- iki":     "Merhaba, Özet bir iki",
		"[Kayıt](https://x.test/a) `kod` > alıntı": "Kayıt kod alıntı",
		"   ": "",
	}
	for in, want := range cases {
		if got := messagePreview(in); got != want {
			t.Fatalf("messagePreview(%q) = %q, want %q", in, got, want)
		}
	}
	long := messagePreview(strings.Repeat("ş", 300))
	if r := []rune(long); len(r) != PreviewChars+1 || !strings.HasSuffix(long, "…") {
		t.Fatalf("long preview = %d runes", len(r))
	}
}

func TestConversationListCarriesLastMessagePreview(t *testing.T) {
	h := newHarness(t, nil)
	h.fake.Responses = []provider.Response{
		provider.FakeText("**Merhaba!** Size nasıl yardımcı olabilirim?"),
		provider.FakeText("Selamlaşma"),
	}
	h.send(t, "selam")
	items, _, err := h.svc.ListConversations(h.ctx, 20, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("conversations = %d", len(items))
	}
	if items[0].LastMessagePreview != "Merhaba! Size nasıl yardımcı olabilirim?" {
		t.Fatalf("preview = %q", items[0].LastMessagePreview)
	}
	if items[0].LastMessageAt == nil {
		t.Fatal("last_message_at must be set")
	}

	// A turn without assistant text keeps the user's text as the preview.
	h.fake.Err = &provider.Error{StatusCode: 500, Message: "boom"}
	h.send(t, "ciro ne kadar?")
	items, _, err = h.svc.ListConversations(h.ctx, 20, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if items[0].LastMessagePreview != "ciro ne kadar?" {
		t.Fatalf("preview after failed turn = %q", items[0].LastMessagePreview)
	}
}
