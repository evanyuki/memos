package store

import (
	"context"
	"time"

	storepb "github.com/usememos/memos/proto/gen/store"
)

const (
	// DailyChecklistPrivate restricts a checklist to its creator.
	DailyChecklistPrivate = "PRIVATE"
	// DailyChecklistPublic allows anyone to read a checklist.
	DailyChecklistPublic = "PUBLIC"
)

// DailyChecklist is one user's structured checklist for a local calendar date.
type DailyChecklist struct {
	ID         int32
	CreatorID  int32
	Date       string
	CreatedTs  int64
	UpdatedTs  int64
	Visibility string
	Payload    *storepb.DailyChecklistPayload
}

// FindDailyChecklist selects a checklist by owner and local calendar date.
type FindDailyChecklist struct {
	CreatorID int32
	Date      string
}

// DeleteDailyChecklist identifies a checklist to remove.
type DeleteDailyChecklist struct {
	CreatorID int32
	Date      string
}

// UpsertDailyChecklist creates or replaces a checklist for its owner and date.
func (s *Store) UpsertDailyChecklist(ctx context.Context, upsert *DailyChecklist) (*DailyChecklist, error) {
	if upsert.Payload == nil {
		upsert.Payload = &storepb.DailyChecklistPayload{}
	}
	now := time.Now().Unix()
	if upsert.CreatedTs == 0 {
		upsert.CreatedTs = now
	}
	upsert.UpdatedTs = now
	if upsert.Visibility == "" {
		upsert.Visibility = DailyChecklistPrivate
	}
	return s.driver.UpsertDailyChecklist(ctx, upsert)
}

// GetDailyChecklist returns a checklist or nil when no matching record exists.
func (s *Store) GetDailyChecklist(ctx context.Context, find *FindDailyChecklist) (*DailyChecklist, error) {
	return s.driver.GetDailyChecklist(ctx, find)
}

// DeleteDailyChecklist removes a checklist.
func (s *Store) DeleteDailyChecklist(ctx context.Context, delete *DeleteDailyChecklist) error {
	return s.driver.DeleteDailyChecklist(ctx, delete)
}
