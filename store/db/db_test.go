package db

import (
	"testing"

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
