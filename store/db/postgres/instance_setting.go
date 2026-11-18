package postgres

import (
	"context"
	"strings"

	"github.com/usememos/memos/store"
)

const upsertInstanceSettingSQL = `INSERT INTO system_setting (name, value) VALUES ($1, $2) ON CONFLICT(name) DO UPDATE SET value = EXCLUDED.value`

func (*DB) UpsertInstanceSetting(ctx context.Context, exec store.SQLExecutor, upsert *store.InstanceSetting) error {
	_, err := exec.ExecContext(ctx, upsertInstanceSettingSQL, upsert.Name, upsert.Value)
	return err
}

func (d *DB) ListInstanceSettings(ctx context.Context, find *store.FindInstanceSetting) ([]*store.InstanceSetting, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.Name != "" {
		where, args = append(where, "name = "+placeholder(len(args)+1)), append(args, find.Name)
	}

	query := `
		SELECT name, value
		FROM system_setting
		WHERE ` + strings.Join(where, " AND ")

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.InstanceSetting{}
	for rows.Next() {
		systemSettingMessage := &store.InstanceSetting{}
		if err := rows.Scan(&systemSettingMessage.Name, &systemSettingMessage.Value); err != nil {
			return nil, err
		}
		list = append(list, systemSettingMessage)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return list, nil
}

func (d *DB) DeleteInstanceSetting(ctx context.Context, delete *store.DeleteInstanceSetting) error {
	stmt := `DELETE FROM system_setting WHERE name = $1`
	_, err := d.db.ExecContext(ctx, stmt, delete.Name)
	return err
}
