package mcp

import (
	"context"
	"errors"

	oauthmodel "github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/modules/oauth/model"
)

// ToolCounter counts the tools a connection would get, for the consent
// screen: the same principal and tools/list result as a token of that user,
// organization, endpoint and scopes.
type ToolCounter struct {
	Principals Resolver
	Sets       map[string]ToolSet
}

// CountTools implements the oauth usecase ToolCounter; a user who could not
// use the endpoint there gets 0.
func (c ToolCounter) CountTools(ctx context.Context, userID, orgID int64, resource string, scopes []string) (int, error) {
	set, ok := c.Sets[resource]
	if !ok {
		return 0, nil
	}
	p, err := c.Principals.Resolve(ctx, oauthmodel.AccessToken{
		UserID: userID, OrganizationID: orgID, Resource: resource, Scopes: scopes,
	})
	if errors.Is(err, ErrForbidden) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	ts, err := set.Tools(ctx, p)
	if err != nil {
		return 0, err
	}
	return len(ts), nil
}
