package cloud

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/piusalfred/whatsapp/config"
	"github.com/piusalfred/whatsapp/templates"
	"github.com/piusalfred/whatsapp/uploads"
)

// Template management goes through the library's templates client
// (/{waba_id}/message_templates); the DOCUMENT header example is uploaded
// with its resumable upload client.

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
	// CopyCode builds an AUTHENTICATION template (Meta-fixed body, expiry
	// footer, copy-code button). Meta's security recommendation ("do not
	// share this code") is deliberately NOT added: the contract OTP notice
	// asks the customer to share the code with the business representative.
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

// samplePDF is the document example submitted with DOCUMENT header templates.
var samplePDF = []byte("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
	"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
	"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
	"trailer<</Root 1 0 R>>\n%%EOF\n")

func requireWABA(conf *config.Config) error {
	if strings.TrimSpace(conf.BusinessAccountID) == "" {
		return model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, fmt.Errorf("waba_id is required"))
	}
	return nil
}

// templatesClient builds the library templates client. The library posts
// creates to /{PhoneNumberID}/message_templates, but Meta only accepts the
// WABA id there, so the client gets a config copy whose phone-number id is
// the WABA id (list/delete already use BusinessAccountID).
func (c *Client) templatesClient(conf *config.Config) *templates.Client {
	cp := *conf
	cp.PhoneNumberID = conf.BusinessAccountID
	return templates.NewClient(&cp, c.senderOptions()...)
}

// components builds the Meta components of a definition (uploading the
// DOCUMENT header example when needed).
func (c *Client) components(ctx context.Context, conf *config.Config, def TemplateDefinition) ([]*templates.Component, error) {
	if def.CopyCode {
		return []*templates.Component{
			{Type: "BODY", AddSecurityRecommendation: false},
			{Type: "FOOTER", CodeExpirationMinutes: def.CodeExpirationMinutes},
			{Type: "BUTTONS", Buttons: []*templates.Button{{Type: "OTP", OTPType: "COPY_CODE", Text: copyCodeText(def.Language)}}},
		}, nil
	}
	var out []*templates.Component
	if def.HeaderDocument {
		handle, err := c.uploadExample(ctx, conf)
		if err != nil {
			return nil, err
		}
		out = append(out, &templates.Component{
			Type: "HEADER", Format: "DOCUMENT", Example: &templates.Example{HeaderHandle: []string{handle}},
		})
	}
	body := &templates.Component{Type: "BODY", Text: def.Body}
	if len(def.Examples) > 0 {
		body.Example = &templates.Example{BodyText: [][]string{def.Examples}}
	}
	return append(out, body), nil
}

// copyCodeText is the copy-code button label per template language.
func copyCodeText(lang string) string {
	if strings.HasPrefix(strings.ToLower(lang), "en") {
		return "Copy code"
	}
	return "Kodu kopyala"
}

// CreateTemplate submits a template (with examples) for review.
func (c *Client) CreateTemplate(ctx context.Context, def TemplateDefinition) (CreatedTemplate, error) {
	conf, err := c.config(ctx)
	if err != nil {
		return CreatedTemplate{}, err
	}
	if err := requireWABA(conf); err != nil {
		return CreatedTemplate{}, err
	}
	req := &templates.CreateRequest{Name: def.Name, Language: def.Language, Category: def.Category}
	if req.Language == "" {
		req.Language = "tr"
	}
	if req.Components, err = c.components(ctx, conf, def); err != nil {
		return CreatedTemplate{}, err
	}

	resp, err := c.templatesClient(conf).Create(ctx, req)
	if err != nil {
		return CreatedTemplate{}, Classify(err)
	}
	if resp == nil || resp.ID == "" {
		return CreatedTemplate{}, model.NewSendError(model.ErrCodeSendFailed, true, fmt.Errorf("create template: response without id"))
	}
	return CreatedTemplate{ID: resp.ID, Status: resp.Status, Category: resp.Category}, nil
}

// EditTemplate resubmits an existing Meta template (APPROVED, REJECTED or
// PAUSED) with new components; Meta reviews it again. The template keeps
// its id, so the result carries the given id.
func (c *Client) EditTemplate(ctx context.Context, metaTemplateID string, def TemplateDefinition) (CreatedTemplate, error) {
	conf, err := c.config(ctx)
	if err != nil {
		return CreatedTemplate{}, err
	}
	if strings.TrimSpace(metaTemplateID) == "" {
		return CreatedTemplate{}, model.NewSendError(model.ErrCodeTemplateMissing, false, fmt.Errorf("edit template: meta template id is required"))
	}
	req := &templates.EditRequest{TemplateID: metaTemplateID, Category: def.Category}
	if req.Components, err = c.components(ctx, conf, def); err != nil {
		return CreatedTemplate{}, err
	}
	if _, err := templates.NewClient(conf, c.senderOptions()...).Edit(ctx, req); err != nil {
		return CreatedTemplate{}, Classify(err)
	}
	return CreatedTemplate{ID: metaTemplateID, Status: "PENDING", Category: def.Category}, nil
}

// uploadExample uploads the sample PDF with the resumable upload API and
// returns the header handle.
func (c *Client) uploadExample(ctx context.Context, conf *config.Config) (string, error) {
	if strings.TrimSpace(conf.AppID) == "" {
		return "", model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false,
			fmt.Errorf("app_id is required to submit a document header template"))
	}
	up := uploads.NewClient(conf, c.senderOptions()...)
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

var listFields = []string{"id", "name", "language", "status", "category", "rejected_reason"}

// ListTemplates returns every template of the WABA.
func (c *Client) ListTemplates(ctx context.Context) ([]RemoteTemplate, error) {
	conf, err := c.config(ctx)
	if err != nil {
		return nil, err
	}
	if err := requireWABA(conf); err != nil {
		return nil, err
	}
	client := c.templatesClient(conf)
	var out []RemoteTemplate
	after := ""
	for page := 0; page < maxTemplatePages; page++ {
		resp, err := client.List(ctx, &templates.ListRequest{Fields: listFields, Limit: 100, After: after})
		if err != nil {
			return nil, Classify(err)
		}
		if resp == nil {
			break
		}
		for _, t := range resp.Data {
			if t == nil {
				continue
			}
			out = append(out, RemoteTemplate{
				ID: t.ID, Name: t.Name, Language: t.Language, Status: t.Status,
				Category: t.Category, RejectedReason: t.RejectedReason,
			})
		}
		if resp.Paging == nil || resp.Paging.Next == "" || resp.Paging.Cursors == nil || resp.Paging.Cursors.After == "" {
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
