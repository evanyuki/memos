package store

import (
	"log/slog"
	"time"
)

const databasePoolStatsInterval = 30 * time.Second

func (s *Store) logDatabasePoolStats() {
	ticker := time.NewTicker(databasePoolStatsInterval)
	defer ticker.Stop()

	var previousWaitCount int64
	for {
		select {
		case <-ticker.C:
			stats := s.driver.GetDB().Stats()
			attrs := []any{
				"max_open", stats.MaxOpenConnections,
				"open", stats.OpenConnections,
				"in_use", stats.InUse,
				"idle", stats.Idle,
				"wait_count", stats.WaitCount,
				"wait_duration", stats.WaitDuration,
			}
			if stats.WaitCount > previousWaitCount {
				slog.Warn("database connection pool contention", attrs...)
			} else {
				slog.Debug("database connection pool stats", attrs...)
			}
			previousWaitCount = stats.WaitCount
		case <-s.databasePoolStatsStop:
			return
		}
	}
}
