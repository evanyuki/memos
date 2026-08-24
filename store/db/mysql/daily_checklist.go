package mysql

import (
	"context"
	"database/sql"
	"errors"

	"google.golang.org/protobuf/encoding/protojson"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func (d *DB) UpsertDailyChecklist(ctx context.Context, upsert *store.DailyChecklist) (*store.DailyChecklist, error) {
	payload, err := protojson.Marshal(upsert.Payload)
	if err != nil {
		return nil, err
	}

	if _, err := d.db.ExecContext(ctx, `
		INSERT INTO daily_checklist (creator_id, checklist_date, created_ts, updated_ts, visibility, payload)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			updated_ts = VALUES(updated_ts),
			visibility = VALUES(visibility),
			payload = VALUES(payload)
	`, upsert.CreatorID, upsert.Date, upsert.CreatedTs, upsert.UpdatedTs, upsert.Visibility, string(payload)); err != nil {
		return nil, err
	}
	return d.GetDailyChecklist(ctx, &store.FindDailyChecklist{CreatorID: upsert.CreatorID, Date: upsert.Date})
}

func (d *DB) GetDailyChecklist(ctx context.Context, find *store.FindDailyChecklist) (*store.DailyChecklist, error) {
	checklist := &store.DailyChecklist{}
	var payload []byte
	if err := d.db.QueryRowContext(ctx, `
		SELECT id, creator_id, checklist_date, created_ts, updated_ts, visibility, payload
		FROM daily_checklist
		WHERE creator_id = ? AND checklist_date = ?
	`, find.CreatorID, find.Date).Scan(
		&checklist.ID,
		&checklist.CreatorID,
		&checklist.Date,
		&checklist.CreatedTs,
		&checklist.UpdatedTs,
		&checklist.Visibility,
		&payload,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	checklist.Payload = &storepb.DailyChecklistPayload{}
	if err := protojson.Unmarshal(payload, checklist.Payload); err != nil {
		return nil, err
	}
	return checklist, nil
}

func (d *DB) DeleteDailyChecklist(ctx context.Context, delete *store.DeleteDailyChecklist) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM daily_checklist WHERE creator_id = ? AND checklist_date = ?", delete.CreatorID, delete.Date)
	return err
}

func deleteDailyChecklistsByCreatorTx(ctx context.Context, tx *sql.Tx, creatorID int32) error {
	_, err := tx.ExecContext(ctx, "DELETE FROM daily_checklist WHERE creator_id = ?", creatorID)
	return err
}
