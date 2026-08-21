package db

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/usememos/memos/internal/profile"
)

func TestNewDBDriverConfiguresExternalConnectionPool(t *testing.T) {
	driver, err := NewDBDriver(&profile.Profile{
		Driver:         "postgres",
		DSN:            "postgres://memos:memos@127.0.0.1:1/memos?sslmode=disable",
		DBMaxOpenConns: 2,
		DBMaxIdleConns: 1,
	})
	if err != nil {
		t.Fatalf("NewDBDriver() error = %v", err)
	}
	t.Cleanup(func() {
		if err := driver.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})

	if got := driver.GetDB().Stats().MaxOpenConnections; got != 2 {
		t.Fatalf("MaxOpenConnections = %d, want 2", got)
	}
}

func TestConfigureSQLConnectionPoolKeepsOneReusableConnection(t *testing.T) {
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("Close() error = %v", err)
		}
	})

	configureSQLConnectionPool(database, &profile.Profile{
		DBMaxOpenConns:    2,
		DBMaxIdleConns:    1,
		DBConnMaxIdleTime: 30 * time.Second,
	})

	ctx := context.Background()
	first, err := database.Conn(ctx)
	if err != nil {
		t.Fatalf("first Conn() error = %v", err)
	}
	second, err := database.Conn(ctx)
	if err != nil {
		first.Close()
		t.Fatalf("second Conn() error = %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("first Close() error = %v", err)
	}
	if err := second.Close(); err != nil {
		t.Fatalf("second Close() error = %v", err)
	}

	stats := database.Stats()
	if stats.MaxOpenConnections != 2 {
		t.Fatalf("MaxOpenConnections = %d, want 2", stats.MaxOpenConnections)
	}
	if stats.Idle != 1 {
		t.Fatalf("Idle = %d, want one reusable connection", stats.Idle)
	}
}
