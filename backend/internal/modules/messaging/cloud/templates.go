package cloud

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/piusalfred/whatsapp/config"
	whttp "github.com/piusalfred/whatsapp/pkg/http"
	"github.com/piusalfred/whatsapp/uploads"
)

// The library (v0.1.12) has no message-template management client, so
// create/list use its HTTP layer (request building, auth, appsecret_proof,
// Graph error decoding) against /{waba_id}/message_templates.

// TemplateDefinition is a template to create in Meta.
type TemplateDefinition struct {
	Name     string
	Language string
	Category string
	Body     string
	Examples []string
	// HeaderDocument adds a DOCUMENT header (example uploaded via the
	// resumable upload API; needs the app id).
	HeaderDocument bool
	// CopyCode builds an AUTHENTICATION template (Meta-fixed body).
	CopyCode              bool
	CodeExpirationMinutes int
}

// CreatedTemplate is Meta's create response.
type CreatedTemplate struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Category string `json:"category"`
}

// RemoteTemplate is one template listed from Meta.
type RemoteTemplate struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Language       string `json:"language"`
	Status         string `json:"status"`
	Category       string `json:"category"`
	RejectedReason string `json:"rejected_reason"`
}

type templateExample struct {
	BodyText     [][]string `json:"body_text,omitempty"`
	HeaderHandle []string   `json:"header_handle,omitempty"`
}

type templateButton struct {
	Type    string `json:"type"`
	OTPType string `json:"otp_type,omitempty"`
	Text    string `json:"text,omitempty"`
}

type templateComponent struct {
	Type                      string           `json:"type"`
	Format                    string           `json:"format,omitempty"`
	Text                      string           `json:"text,omitempty"`
	Example                   *templateExample `json:"example,omitempty"`
	AddSecurityRecommendation bool             `json:"add_security_recommendation,omitempty"`
	CodeExpirationMinutes     int              `json:"code_expiration_minutes,omitempty"`
	Buttons                   []templateButton `json:"buttons,omitempty"`
}

type createTemplateRequest struct {
	Name       string              `json:"name"`
	Language   string              `json:"language"`
	Category   string              `json:"category"`
	Components []templateComponent `json:"components"`
}

type listTemplatesResponse struct {
	Data   []RemoteTemplate `json:"data"`
	Paging struct {
		Cursors struct {
			After string `json:"after"`
		} `json:"cursors"`
		Next string `json:"next"`
	} `json:"paging"`
}

// samplePDF is the document example submitted with DOCUMENT header templates.
var samplePDF = []byte("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
	"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
	"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
	"trailer<</Root 1 0 R>>\n%%EOF\n")

func authOptions[T any](conf *config.Config) []whttp.RequestOption[T] {
	return []whttp.RequestOption[T]{
		whttp.WithRequestBearer[T](conf.AccessToken),
		whttp.WithRequestAppSecret[T](conf.AppSecret),
		whttp.WithRequestSecured[T](conf.SecureRequests),
	}
}

func requireWABA(conf *config.Config) error {
	if strings.TrimSpace(conf.BusinessAccountID) == "" {
		return model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, fmt.Errorf("waba_id is required"))
	}
	return nil
}

// CreateTemplate submits a template (with examples) for review.
func (c *Client) CreateTemplate(ctx context.Context, def TemplateDefinition) (CreatedTemplate, error) {
	conf, reader, err := c.config(ctx)
	if err != nil {
		return CreatedTemplate{}, err
	}
	if err := requireWABA(conf); err != nil {
		return CreatedTemplate{}, err
	}
	req := createTemplateRequest{Name: def.Name, Language: def.Language, Category: def.Category}
	if req.Language == "" {
		req.Language = "tr"
	}
	if def.CopyCode {
		req.Components = []templateComponent{
			{Type: "BODY", AddSecurityRecommendation: true},
			{Type: "FOOTER", CodeExpirationMinutes: def.CodeExpirationMinutes},
			{Type: "BUTTONS", Buttons: []templateButton{{Type: "OTP", OTPType: "COPY_CODE", Text: "Kodu kopyala"}}},
		}
	} else {
		if def.HeaderDocument {
			handle, err := c.uploadExample(ctx, conf, reader)
			if err != nil {
				return CreatedTemplate{}, err
			}
			req.Components = append(req.Components, templateComponent{
				Type: "HEADER", Format: "DOCUMENT", Example: &templateExample{HeaderHandle: []string{handle}},
			})
		}
		body := templateComponent{Type: "BODY", Text: def.Body}
		if len(def.Examples) > 0 {
			body.Example = &templateExample{BodyText: [][]string{def.Examples}}
		}
		req.Components = append(req.Components, body)
	}

	opts := append(authOptions[createTemplateRequest](conf),
		whttp.WithRequestEndpoints[createTemplateRequest](conf.APIVersion, conf.BusinessAccountID, "message_templates"),
		whttp.WithRequestMessage(&req),
	)
	var out CreatedTemplate
	sender := whttp.NewSender[createTemplateRequest](whttp.WithCoreClientHTTPClient[createTemplateRequest](c.http))
	if err := sender.Send(ctx, whttp.MakeRequest(http.MethodPost, conf.BaseURL, opts...),
		whttp.ResponseDecoderJSON(&out, whttp.DecodeOptions{DisallowEmptyResponse: true, InspectResponseError: true})); err != nil {
		return CreatedTemplate{}, Classify(err)
	}
	return out, nil
}

// uploadExample uploads the sample PDF with the resumable upload API and
// returns the header handle.
func (c *Client) uploadExample(ctx context.Context, conf *config.Config, reader config.Reader) (string, error) {
	if strings.TrimSpace(conf.AppID) == "" {
		return "", model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false,
			fmt.Errorf("app_id is required to submit a document header template"))
	}
	up := uploads.NewBaseClient(reader, whttp.NewAnySender(whttp.WithCoreClientHTTPClient[any](c.http)))
	session, err := up.InitUploadSession(ctx, &uploads.InitUploadSessionRequest{
		FileName: "teklif-ornek.pdf", FileLength: int64(len(samplePDF)), FileType: "application/pdf",
	})
	if err != nil {
		return "", Classify(err)
	}
	chunk, err := up.UploadChunk(ctx, &uploads.UploadChunkRequest{
		UploadSessionID: session.ID, FileOffset: 0, FileReader: bytes.NewReader(samplePDF),
	})
	if err != nil {
		return "", Classify(err)
	}
	if chunk.FileHandle == "" {
		return "", model.NewSendError(model.ErrCodeMediaUploadFailed, true, fmt.Errorf("upload returned no handle"))
	}
	return chunk.FileHandle, nil
}

// maxTemplatePages bounds paging through the WABA template list.
const maxTemplatePages = 20

// ListTemplates returns every template of the WABA.
func (c *Client) ListTemplates(ctx context.Context) ([]RemoteTemplate, error) {
	conf, _, err := c.config(ctx)
	if err != nil {
		return nil, err
	}
	if err := requireWABA(conf); err != nil {
		return nil, err
	}
	sender := whttp.NewAnySender(whttp.WithCoreClientHTTPClient[any](c.http))
	var out []RemoteTemplate
	after := ""
	for page := 0; page < maxTemplatePages; page++ {
		q := map[string]string{
			"fields": "id,name,language,status,category,rejected_reason",
			"limit":  strconv.Itoa(100),
		}
		if after != "" {
			q["after"] = after
		}
		opts := append(authOptions[any](conf),
			whttp.WithRequestEndpoints[any](conf.APIVersion, conf.BusinessAccountID, "message_templates"),
			whttp.WithRequestQueryParams[any](q),
		)
		var resp listTemplatesResponse
		if err := sender.Send(ctx, whttp.MakeRequest(http.MethodGet, conf.BaseURL, opts...),
			whttp.ResponseDecoderJSON(&resp, whttp.DecodeOptions{DisallowEmptyResponse: true, InspectResponseError: true})); err != nil {
			return nil, Classify(err)
		}
		out = append(out, resp.Data...)
		if resp.Paging.Next == "" || resp.Paging.Cursors.After == "" {
			break
		}
		after = resp.Paging.Cursors.After
	}
	return out, nil
}

// MapStatus maps a Meta template status to whatsapp_cloud_templates.status.
func MapStatus(meta string) string {
	switch strings.ToUpper(strings.TrimSpace(meta)) {
	case "APPROVED":
		return "approved"
	case "REJECTED":
		return "rejected"
	case "PAUSED":
		return "paused"
	case "DISABLED", "ARCHIVED", "LIMIT_EXCEEDED":
		return "disabled"
	case "DELETED", "PENDING_DELETION":
		return "not_submitted"
	default: // PENDING, IN_APPEAL, …
		return "pending"
	}
}
