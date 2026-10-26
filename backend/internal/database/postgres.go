package database

import (
	"context"
	"fmt"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/config"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/bizclock"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SessionTimeZone is the Postgres session time zone of every pool
// connection: the business time zone (Europe/Istanbul). With it,
// timestamptz::date, date_trunc(..., timestamptz), CURRENT_DATE and
// date -> timestamptz casts all follow Türkiye's calendar day instead of the
// server default (UTC in production). Timestamps keep being instants; only
// day arithmetic in SQL changes. Expressions that name a zone explicitly
// (AT TIME ZONE 'Europe/Istanbul') are unaffected.
const SessionTimeZone = bizclock.TimeZone

// ParsePoolConfig parses dsn and applies the session settings every
// connection of the app must have (SessionTimeZone). Tests that open their
// own pool should use it (or NewPoolFromDSN) so SQL sees the same day
// boundaries as production.
func ParsePoolConfig(dsn string) (*pgxpool.Config, error) {
	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("database: parse config: %w", err)
	}
	if poolCfg.ConnConfig.RuntimeParams == nil {
		poolCfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	poolCfg.ConnConfig.RuntimeParams["timezone"] = SessionTimeZone
	return poolCfg, nil
}

// NewPoolFromDSN opens a pool on dsn with the app session settings, without
// the production sizing of NewPostgresPool (for tests and tools).
func NewPoolFromDSN(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	poolCfg, err := ParsePoolConfig(dsn)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, poolCfg)
}

// NewPostgresPool opens a pgx connection pool and verifies connectivity.
func NewPostgresPool(ctx context.Context, cfg config.DBConfig) (*pgxpool.Pool, error) {
	poolCfg, err := ParsePoolConfig(cfg.DSN())
	if err != nil {
		return nil, err
	}

	poolCfg.MaxConns = cfg.MaxConns
	poolCfg.MinConns = 1
	poolCfg.MaxConnLifetime = time.Hour
	poolCfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("database: connect: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: ping: %w", err)
	}

	return pool, nil
}

// Ping checks database availability.
func Ping(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("database: pool is nil")
	}
	return pool.Ping(ctx)
}

// NewQueries returns sqlc Queries backed by the given pool.
func NewQueries(pool *pgxpool.Pool) *db.Queries {
	return db.New(pool)
}
