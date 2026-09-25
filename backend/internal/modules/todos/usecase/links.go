package usecase

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrLinkNotFound is returned by a LinkResolver for unknown / foreign records.
var ErrLinkNotFound = errors.New("link not found")

// LinkResolver resolves lead and quote links for todos. The Leads & Quotes
// module implements it and registers it with Service.SetLinkResolver in
// internal/httpserver/server.go. Every method MUST scope by orgID.
type LinkResolver interface {
	// ResolveLead maps a lead uuid to its internal id within the org
	// (ErrLinkNotFound when missing or in another organization).
	ResolveLead(ctx context.Context, orgID int64, id uuid.UUID) (int64, error)
	// ResolveQuote maps a quote uuid to its internal id within the org.
	ResolveQuote(ctx context.Context, orgID int64, id uuid.UUID) (int64, error)
	// DescribeLeads returns uuid + label for a page of lead ids (one query).
	DescribeLeads(ctx context.Context, orgID int64, ids []int64) (map[int64]Ref, error)
	// DescribeQuotes returns uuid + label (e.g. quote number) for a page of quote ids.
	DescribeQuotes(ctx context.Context, orgID int64, ids []int64) (map[int64]Ref, error)
}

// NoLinks is the default resolver until leads/quotes exist: every lookup is
// "not found" and descriptions are empty.
type NoLinks struct{}

// ResolveLead implements LinkResolver.
func (NoLinks) ResolveLead(context.Context, int64, uuid.UUID) (int64, error) {
	return 0, ErrLinkNotFound
}

// ResolveQuote implements LinkResolver.
func (NoLinks) ResolveQuote(context.Context, int64, uuid.UUID) (int64, error) {
	return 0, ErrLinkNotFound
}

// DescribeLeads implements LinkResolver.
func (NoLinks) DescribeLeads(context.Context, int64, []int64) (map[int64]Ref, error) {
	return map[int64]Ref{}, nil
}

// DescribeQuotes implements LinkResolver.
func (NoLinks) DescribeQuotes(context.Context, int64, []int64) (map[int64]Ref, error) {
	return map[int64]Ref{}, nil
}

// SetLinkResolver installs the leads/quotes resolver.
func (s *Service) SetLinkResolver(r LinkResolver) {
	if r == nil {
		r = NoLinks{}
	}
	s.links = r
}

func (s *Service) resolveLink(ctx context.Context, orgID int64, id *uuid.UUID, kind string) (int64, error) {
	if id == nil || *id == uuid.Nil {
		return 0, nil
	}
	var (
		v   int64
		err error
	)
	if kind == "lead" {
		v, err = s.links.ResolveLead(ctx, orgID, *id)
	} else {
		v, err = s.links.ResolveQuote(ctx, orgID, *id)
	}
	if errors.Is(err, ErrLinkNotFound) {
		return 0, invalid("%s not found", kind)
	}
	return v, err
}
