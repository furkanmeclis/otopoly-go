// Package cloud talks to the WhatsApp Cloud API (Meta Graph API) through
// github.com/piusalfred/whatsapp. Credentials come from a config.Reader on
// every call (platform_whatsapp_settings, decrypted), so panel edits apply
// without a restart. No secrets are logged.
package cloud

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/model"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/messaging/providers"
	"github.com/piusalfred/whatsapp"
	"github.com/piusalfred/whatsapp/config"
	wamedia "github.com/piusalfred/whatsapp/media"
	"github.com/piusalfred/whatsapp/message"
	"github.com/piusalfred/whatsapp/message/media"
	"github.com/piusalfred/whatsapp/message/template"
	whttp "github.com/piusalfred/whatsapp/pkg/http"
)

// DefaultTimeout bounds one Graph API call.
const DefaultTimeout = 30 * time.Second

// Client is a Cloud API client bound to a config reader.
type Client struct {
	reader config.Reader
	http   *http.Client
}

// New creates a client. httpClient may be nil (default client with timeout).
func New(reader config.Reader, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: DefaultTimeout}
	}
	return &Client{reader: reader, http: httpClient}
}

// Document is a file sent as the template DOCUMENT header.
type Document struct {
	Data     []byte
	FileName string
	MimeType string
}

// TemplateMessage is one template send.
type TemplateMessage struct {
	Name       string
	Language   string
	BodyParams []string
	// OTPCode sends an AUTHENTICATION template (body {{1}} + copy-code button).
	OTPCode string
	// Document adds a DOCUMENT header (uploaded first via the media API).
	Document *Document
}

// config reads the credentials once per operation; the library clients are
// built from this snapshot so an upload and the following send use the same
// values.
func (c *Client) config(ctx context.Context) (*config.Config, error) {
	if c == nil || c.reader == nil {
		return nil, model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, fmt.Errorf("cloud api reader missing"))
	}
	conf, err := c.reader.Read(ctx)
	if err != nil || conf == nil {
		if err == nil {
			err = fmt.Errorf("empty config")
		}
		return nil, model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, err)
	}
	cp := *conf
	if strings.TrimSpace(cp.BaseURL) == "" {
		cp.BaseURL = whatsapp.BaseURL
	}
	return &cp, nil
}

func (c *Client) senderOptions() []whttp.CoreSenderOption {
	return []whttp.CoreSenderOption{whttp.WithSenderHTTPClient(c.http)}
}

// SendTemplate sends a template message and returns the wamid.
func (c *Client) SendTemplate(ctx context.Context, phone string, m TemplateMessage) (string, error) {
	conf, err := c.config(ctx)
	if err != nil {
		return "", err
	}
	to, err := providers.NormalizeWhatsAppPhone(phone)
	if err != nil {
		return "", model.NewSendError(model.ErrCodeInvalidRecipient, false, err)
	}
	lang := m.Language
	if lang == "" {
		lang = "tr"
	}

	if m.OTPCode != "" {
		return c.sendAuthTemplate(ctx, conf, to, m.Name, lang, m.OTPCode)
	}
	tmpl := &template.Template{
		Name:     m.Name,
		Language: &template.Language{Code: lang, Policy: "deterministic"},
	}
	{
		if m.Document != nil {
			mediaID, err := c.uploadDocument(ctx, conf, *m.Document)
			if err != nil {
				return "", err
			}
			tmpl.Components = append(tmpl.Components, &template.Component{
				Type: template.TemplateComponentTypeHeader,
				Parameters: []*template.Parameter{{
					Type:     template.TemplateParameterTypeDocument,
					Document: &media.Document{ID: mediaID, Filename: m.Document.FileName},
				}},
			})
		}
		if len(m.BodyParams) > 0 {
			params := make([]*template.Parameter, len(m.BodyParams))
			for i, v := range m.BodyParams {
				params[i] = &template.Parameter{Type: template.TemplateParameterTypeText, Text: v}
			}
			tmpl.Components = append(tmpl.Components, &template.Component{
				Type: template.TemplateComponentTypeBody, Parameters: params,
			})
		}
	}

	client := message.NewClient(conf, c.senderOptions()...)
	resp, err := client.SendTemplateMessage(ctx, message.SendTo(to), tmpl)
	if err != nil {
		return "", Classify(err)
	}
	if resp == nil {
		return wamidOf(nil)
	}
	return wamidOf(resp.Messages)
}

// wamidOf extracts the message id of a send response.
func wamidOf(messages []*message.ID) (string, error) {
	if len(messages) == 0 || messages[0] == nil || messages[0].ID == "" {
		return "", model.NewSendError(model.ErrCodeSendFailed, true, fmt.Errorf("cloud api: response without message id"))
	}
	return messages[0].ID, nil
}

// authTemplateRequest is the wire payload of an AUTHENTICATION template
// send. It exists because the library's component struct declares
// `index` with omitempty: the copy-code button is at index 0, so the field
// is dropped and Meta answers (#100) "missing parameter index for button
// component". Here index is always serialized.
type authTemplateRequest struct {
	MessagingProduct string       `json:"messaging_product"`
	To               string       `json:"to"`
	Type             string       `json:"type"`
	Template         authTemplate `json:"template"`
}

type authTemplate struct {
	Name       string            `json:"name"`
	Language   template.Language `json:"language"`
	Components []authComponent   `json:"components"`
}

type authComponent struct {
	Type       string          `json:"type"`
	SubType    string          `json:"sub_type,omitempty"`
	Index      *int            `json:"index,omitempty"`
	Parameters []authParameter `json:"parameters"`
}

type authParameter struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// sendAuthTemplate sends an AUTHENTICATION template (body {{1}} = code,
// copy-code button at index 0 with the same code) through the library's
// HTTP stack, so errors classify like every other send.
func (c *Client) sendAuthTemplate(ctx context.Context, conf *config.Config, to, name, lang, code string) (string, error) {
	zero := 0
	param := authParameter{Type: "text", Text: code}
	body := &authTemplateRequest{
		MessagingProduct: "whatsapp", To: to, Type: "template",
		Template: authTemplate{
			Name:     name,
			Language: template.Language{Code: lang, Policy: "deterministic"},
			Components: []authComponent{
				{Type: "body", Parameters: []authParameter{param}},
				{Type: "button", SubType: "url", Index: &zero, Parameters: []authParameter{param}},
			},
		},
	}
	b := whttp.NewRequestBuilder(http.MethodPost, conf.BaseURL).
		Auth(conf.AuthConfig()).
		Type(whttp.RequestTypeSendMessage).
		Endpoints(conf.APIVersion, conf.PhoneNumberID, "messages")
	req := whttp.BuildRequest(b, body)
	resp := &message.BaseResponse{}
	decoder := whttp.NewResponseCapturer(whttp.ResponseDecoderJSON(resp, whttp.DecodeOptionsStrict()))
	if err := whttp.NewBaseClient[authTemplateRequest](c.senderOptions()...).Send(ctx, req, decoder); err != nil {
		return "", Classify(fmt.Errorf("send auth template: %w", err))
	}
	return wamidOf(resp.Messages)
}

// uploadDocument uploads the file through the media endpoint (the library
// still uploads from a path only, so the bytes go through a short-lived temp
// file).
func (c *Client) uploadDocument(ctx context.Context, conf *config.Config, doc Document) (string, error) {
	if len(doc.Data) == 0 {
		return "", model.NewSendError(model.ErrCodeMediaUploadFailed, false, fmt.Errorf("document is empty"))
	}
	dir, err := os.MkdirTemp("", "wa-cloud-media-")
	if err != nil {
		return "", model.NewSendError(model.ErrCodeMediaUploadFailed, true, err)
	}
	defer func() { _ = os.RemoveAll(dir) }()
	name := filepath.Base(strings.TrimSpace(doc.FileName))
	if name == "" || name == "." || name == "/" {
		name = "document.pdf"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, doc.Data, 0o600); err != nil {
		return "", model.NewSendError(model.ErrCodeMediaUploadFailed, true, err)
	}
	mediaType := wamedia.Type(doc.MimeType)
	if _, ok := wamedia.InfoMap[mediaType]; !ok {
		mediaType = wamedia.TypeDocPDF
	}
	mc := wamedia.NewClient(conf, c.senderOptions()...)
	resp, err := mc.Upload(ctx, &wamedia.UploadRequest{MediaType: mediaType, Filepath: path})
	if err != nil {
		se := Classify(err)
		if se.Code == model.ErrCodeSendFailed {
			se.Code = model.ErrCodeMediaUploadFailed
		}
		return "", se
	}
	if resp == nil || resp.ID == "" {
		return "", model.NewSendError(model.ErrCodeMediaUploadFailed, true, fmt.Errorf("media upload returned no id"))
	}
	return resp.ID, nil
}
