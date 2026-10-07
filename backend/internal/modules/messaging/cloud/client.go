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
	"github.com/piusalfred/whatsapp/media"
	"github.com/piusalfred/whatsapp/message"
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

// config reads the credentials once per operation; the library clients get a
// fixed reader so an upload and the following send use the same values.
func (c *Client) config(ctx context.Context) (*config.Config, config.Reader, error) {
	if c == nil || c.reader == nil {
		return nil, nil, model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, fmt.Errorf("cloud api reader missing"))
	}
	conf, err := c.reader.Read(ctx)
	if err != nil || conf == nil {
		if err == nil {
			err = fmt.Errorf("empty config")
		}
		return nil, nil, model.NewSendError(model.ErrCodePlatformSenderNotConfigured, false, err)
	}
	cp := *conf
	if strings.TrimSpace(cp.BaseURL) == "" {
		cp.BaseURL = whatsapp.BaseURL
	}
	fixed := config.ReaderFunc(func(context.Context) (*config.Config, error) { return &cp, nil })
	return &cp, fixed, nil
}

// SendTemplate sends a template message and returns the wamid.
func (c *Client) SendTemplate(ctx context.Context, phone string, m TemplateMessage) (string, error) {
	_, reader, err := c.config(ctx)
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

	var tmpl *message.Template
	if m.OTPCode != "" {
		tmpl = message.NewAuthTemplate(&message.AuthTemplateRequest{
			Name: m.Name, LanguageCode: lang, LanguagePolicy: "deterministic", OneTimePassword: m.OTPCode,
		})
	} else {
		tmpl = &message.Template{
			Name:     m.Name,
			Language: &message.TemplateLanguage{Code: lang, Policy: "deterministic"},
		}
		if m.Document != nil {
			mediaID, err := c.uploadDocument(ctx, reader, *m.Document)
			if err != nil {
				return "", err
			}
			tmpl.Components = append(tmpl.Components, &message.TemplateComponent{
				Type: message.TemplateComponentTypeHeader,
				Parameters: []*message.TemplateParameter{{
					Type:     message.TemplateParameterTypeDocument,
					Document: &message.Document{ID: mediaID, Filename: m.Document.FileName},
				}},
			})
		}
		if len(m.BodyParams) > 0 {
			params := make([]*message.TemplateParameter, len(m.BodyParams))
			for i, v := range m.BodyParams {
				params[i] = &message.TemplateParameter{Type: message.TemplateParameterTypeText, Text: v}
			}
			tmpl.Components = append(tmpl.Components, &message.TemplateComponent{
				Type: message.TemplateComponentTypeBody, Parameters: params,
			})
		}
	}

	client, err := message.NewBaseClient(whttp.NewSender[message.Message](
		whttp.WithCoreClientHTTPClient[message.Message](c.http)), reader)
	if err != nil {
		return "", model.NewSendError(model.ErrCodeSendFailed, false, err)
	}
	resp, err := client.SendTemplate(ctx, message.NewRequest(to, tmpl))
	if err != nil {
		return "", Classify(err)
	}
	if resp == nil || len(resp.Messages) == 0 || resp.Messages[0] == nil || resp.Messages[0].ID == "" {
		return "", model.NewSendError(model.ErrCodeSendFailed, true, fmt.Errorf("cloud api: response without message id"))
	}
	return resp.Messages[0].ID, nil
}

// uploadDocument uploads the file through the media endpoint (the library
// uploads from a path, so the bytes go through a short-lived temp file).
func (c *Client) uploadDocument(ctx context.Context, reader config.Reader, doc Document) (string, error) {
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
	mediaType := media.Type(doc.MimeType)
	if _, ok := media.InfoMap[mediaType]; !ok {
		mediaType = media.TypeDocPDF
	}
	mc := media.NewBaseClient(reader, whttp.NewAnySender(whttp.WithCoreClientHTTPClient[any](c.http)))
	resp, err := mc.Upload(ctx, &media.UploadRequest{MediaType: mediaType, Filepath: path})
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
