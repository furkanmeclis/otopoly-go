package usecase

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// SignerSlot describes a required/optional signer role on a preset or template.
type SignerSlot struct {
	Role     string `json:"role"`
	Label    string `json:"label"`
	Required bool   `json:"required"`
}

// Preset is a platform-level contract preset (no organization).
type Preset struct {
	UUID              uuid.UUID       `json:"uuid"`
	Title             string          `json:"title"`
	Description       string          `json:"description"`
	Category          string          `json:"category"`
	ContentJSON       json.RawMessage `json:"content_json"`
	ContentHTML       string          `json:"content_html"`
	Variables         []string        `json:"variables"`
	SignerSlots       []SignerSlot    `json:"signer_slots"`
	SignatureRequired bool            `json:"signature_required"`
	OTPRequired       bool            `json:"otp_required"`
	IsActive          bool            `json:"is_active"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// Template is an organization-scoped contract template.
type Template struct {
	UUID              uuid.UUID       `json:"uuid"`
	PresetUUID        *uuid.UUID      `json:"preset_uuid,omitempty"`
	Title             string          `json:"title"`
	Description       string          `json:"description"`
	Category          string          `json:"category"`
	ContentJSON       json.RawMessage `json:"content_json"`
	ContentHTML       string          `json:"content_html"`
	Variables         []string        `json:"variables"`
	SignerSlots       []SignerSlot    `json:"signer_slots"`
	SignatureRequired bool            `json:"signature_required"`
	OTPRequired       bool            `json:"otp_required"`
	IsActive          bool            `json:"is_active"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

// Signer is a signing slot on a contract instance.
type Signer struct {
	UUID      uuid.UUID `json:"uuid"`
	Role      string    `json:"role"`
	Label     string    `json:"label"`
	Required  bool      `json:"required"`
	SortOrder int32     `json:"sort_order"`
	Status    string    `json:"status"`
	// SuggestedName pre-fills the signing form (job customer / assignee / creator).
	SuggestedName string `json:"suggested_name"`
	Phone         string `json:"phone"`
	// OTPRequired is true when this signer must verify a WhatsApp OTP before signing.
	OTPRequired    bool       `json:"otp_required"`
	OTPVerified    bool       `json:"otp_verified"`
	OTPVerifiedAt  *time.Time `json:"otp_verified_at,omitempty"`
	OTPChannel     string     `json:"otp_channel,omitempty"`
	OTPPhoneMasked string     `json:"otp_phone_masked,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// Signature is a captured signature for a signer.
type Signature struct {
	UUID           uuid.UUID `json:"uuid"`
	SignerUUID     uuid.UUID `json:"signer_uuid"`
	DisplayName    string    `json:"display_name"`
	ObjectKey      string    `json:"object_key"`
	URL            *string   `json:"url,omitempty"`
	ContentSHA256  string    `json:"content_sha256"`
	SignedByUserID int64     `json:"signed_by_user_id"`
	IPAddress      string    `json:"ip_address"`
	UserAgent      string    `json:"user_agent"`
	SignedAt       time.Time `json:"signed_at"`
}

// Media is an attachment on a contract instance.
type Media struct {
	UUID        uuid.UUID `json:"uuid"`
	ObjectKey   string    `json:"object_key"`
	URL         *string   `json:"url,omitempty"`
	ContentType string    `json:"content_type"`
	FileName    string    `json:"file_name"`
	ByteSize    int64     `json:"byte_size"`
	Caption     string    `json:"caption"`
	SortOrder   int32     `json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
}

// Instance is a filled contract bound to a subject (e.g. service job).
type Instance struct {
	UUID              uuid.UUID         `json:"uuid"`
	Number            int32             `json:"number"`
	NumberLabel       string            `json:"number_label"`
	Locale            string            `json:"locale"`
	TemplateUUID      *uuid.UUID        `json:"template_uuid,omitempty"`
	Title             string            `json:"title"`
	SubjectType       string            `json:"subject_type"`
	SubjectUUID       uuid.UUID         `json:"subject_uuid"`
	ContentJSON       json.RawMessage   `json:"content_json"`
	ContentHTML       string            `json:"content_html"`
	VariablesResolved map[string]string `json:"variables_resolved"`
	SignatureRequired bool              `json:"signature_required"`
	OTPRequired       bool              `json:"otp_required"`
	Status            string            `json:"status"`
	ContentSHA256     *string           `json:"content_sha256,omitempty"`
	PDFObjectKey      *string           `json:"pdf_object_key,omitempty"`
	PDFURL            *string           `json:"pdf_url,omitempty"`
	PDFError          string            `json:"pdf_error"`
	ExecutedAt        *time.Time        `json:"executed_at,omitempty"`
	VoidedAt          *time.Time        `json:"voided_at,omitempty"`
	CreatedAt         time.Time         `json:"created_at"`
	UpdatedAt         time.Time         `json:"updated_at"`
	Signers           []Signer          `json:"signers,omitempty"`
	Signatures        []Signature       `json:"signatures,omitempty"`
	Media             []Media           `json:"media,omitempty"`
}

// PresetFilters filters platform presets.
type PresetFilters struct {
	Q        string
	IsActive *bool
	Sort     string
}

// TemplateFilters filters tenant templates.
type TemplateFilters struct {
	Q        string
	IsActive *bool
	Sort     string
}

// InstanceFilters filters tenant instances.
type InstanceFilters struct {
	Q           string
	Status      string
	SubjectType string
	SubjectUUID *uuid.UUID
}

// CreatePresetInput creates a platform preset.
type CreatePresetInput struct {
	Title             string          `json:"title"`
	Description       string          `json:"description"`
	Category          string          `json:"category"`
	ContentJSON       json.RawMessage `json:"content_json"`
	ContentHTML       string          `json:"content_html"`
	Variables         []string        `json:"variables"`
	SignerSlots       []SignerSlot    `json:"signer_slots"`
	SignatureRequired *bool           `json:"signature_required"`
	OTPRequired       *bool           `json:"otp_required"`
	IsActive          *bool           `json:"is_active"`
}

// PatchPresetInput partially updates a platform preset.
type PatchPresetInput struct {
	Title             *string          `json:"title"`
	Description       *string          `json:"description"`
	Category          *string          `json:"category"`
	ContentJSON       *json.RawMessage `json:"content_json"`
	ContentHTML       *string          `json:"content_html"`
	Variables         *[]string        `json:"variables"`
	SignerSlots       *[]SignerSlot    `json:"signer_slots"`
	SignatureRequired *bool            `json:"signature_required"`
	OTPRequired       *bool            `json:"otp_required"`
	IsActive          *bool            `json:"is_active"`
}

// CreateTemplateInput creates a tenant template.
type CreateTemplateInput struct {
	PresetUUID        *uuid.UUID      `json:"preset_uuid"`
	Title             string          `json:"title"`
	Description       string          `json:"description"`
	Category          string          `json:"category"`
	ContentJSON       json.RawMessage `json:"content_json"`
	ContentHTML       string          `json:"content_html"`
	Variables         []string        `json:"variables"`
	SignerSlots       []SignerSlot    `json:"signer_slots"`
	SignatureRequired *bool           `json:"signature_required"`
	OTPRequired       *bool           `json:"otp_required"`
	IsActive          *bool           `json:"is_active"`
}

// PatchTemplateInput partially updates a tenant template.
type PatchTemplateInput struct {
	Title             *string          `json:"title"`
	Description       *string          `json:"description"`
	Category          *string          `json:"category"`
	ContentJSON       *json.RawMessage `json:"content_json"`
	ContentHTML       *string          `json:"content_html"`
	Variables         *[]string        `json:"variables"`
	SignerSlots       *[]SignerSlot    `json:"signer_slots"`
	SignatureRequired *bool            `json:"signature_required"`
	OTPRequired       *bool            `json:"otp_required"`
	IsActive          *bool            `json:"is_active"`
}

// CloneTemplateInput clones a platform preset into the tenant.
type CloneTemplateInput struct {
	PresetUUID uuid.UUID `json:"preset_uuid"`
	Title      string    `json:"title"`
}

// CreateInstanceInput creates a contract instance from a template + subject.
type CreateInstanceInput struct {
	TemplateUUID uuid.UUID `json:"template_uuid"`
	SubjectType  string    `json:"subject_type"`
	SubjectUUID  uuid.UUID `json:"subject_uuid"`
	Title        string    `json:"title"`
	// DeferExecute keeps a contract without pending signers open so photos can
	// be attached first; the client then calls FinalizeInstance.
	DeferExecute bool `json:"defer_execute"`
}

// SignInput captures a PNG signature for a signer slot.
type SignInput struct {
	DisplayName        string `json:"display_name"`
	SignaturePNGBase64 string `json:"signature_png_base64"`
	IPAddress          string `json:"-"`
	UserAgent          string `json:"-"`
}

// UploadMediaInput uploads an attachment onto an instance.
type UploadMediaInput struct {
	FileName    string
	ContentType string
	Caption     string
	Body        []byte
}
