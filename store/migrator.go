package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pkg/errors"
	"golang.org/x/mod/semver"
	"google.golang.org/protobuf/encoding/protojson"

	storepb "github.com/usememos/memos/proto/gen/store"
)

//go:embed migration
var migrationFS embed.FS

//go:embed seed
var seedFS embed.FS

const (
	// MigrateFileNameSplit is the split character between the patch version and the description in the migration file name.
	// For example, "1__create_table.sql".
	MigrateFileNameSplit = "__"
	// LatestSchemaFileName is the name of the latest schema file.
	// This file is used to initialize fresh installations with the current schema.
	LatestSchemaFileName = "LATEST.sql"
)

func compareSchemaVersions(a, b string) int {
	return semver.Compare("v"+a, "v"+b)
}

// Migrate initializes or upgrades the schema and loads demo data when enabled.
func (s *Store) Migrate(ctx context.Context) error {
	target, err := s.GetCurrentSchemaVersion()
	if err != nil {
		return err
	}
	initialized, err := s.driver.IsInitialized(ctx)
	if err != nil {
		return errors.Wrap(err, "failed to check if database is initialized")
	}
	if !initialized {
		if err := s.initializeSchema(ctx, target); err != nil {
			return err
		}
	} else {
		setting, err := s.GetStoredInstanceSetting(ctx, &FindInstanceSetting{Name: storepb.InstanceSettingKey_BASIC.String()})
		if err != nil {
			return errors.Wrap(err, "failed to read database schema version")
		}
		basic := setting.GetBasicSetting()
		current := basic.GetSchemaVersion()
		if compareSchemaVersions(current, "0.22.0") < 0 {
			return errors.Errorf("database schema %q is too old to upgrade directly to %s; upgrade through v0.25.3 first", current, target)
		}
		switch compareSchemaVersions(current, target) {
		case 1:
			return errors.Errorf("cannot downgrade schema version from %s to %s", current, target)
		case -1:
			if err := s.applyMigrations(ctx, basic, target); err != nil {
				return err
			}
		}
	}

	if s.profile.Demo && s.profile.Driver == "sqlite" {
		return s.seed(ctx)
	}
	return nil
}

func (s *Store) applyMigrations(ctx context.Context, basic *storepb.InstanceBasicSetting, targetSchemaVersion string) error {
	currentSchemaVersion := basic.GetSchemaVersion()
	filePaths, err := fs.Glob(migrationFS, fmt.Sprintf("%s*/*.sql", s.getMigrationBasePath()))
	if err != nil {
		return errors.Wrap(err, "failed to read migration files")
	}

	tx, err := s.driver.GetDB().BeginTx(ctx, nil)
	if err != nil {
		return errors.Wrap(err, "failed to start transaction")
	}
	defer tx.Rollback()

	migrationsApplied := 0
	for _, filePath := range filePaths {
		fileSchemaVersion, err := getSchemaVersionOfMigrateScript(filePath)
		if err != nil {
			return errors.Wrap(err, "failed to get schema version of migrate script")
		}

		if compareSchemaVersions(fileSchemaVersion, currentSchemaVersion) <= 0 {
			continue
		}
		if err := executeSQLFile(ctx, tx, migrationFS, filePath); err != nil {
			return err
		}
		migrationsApplied++
	}

	if err := s.commitSchemaVersion(ctx, tx, basic, targetSchemaVersion); err != nil {
		return err
	}
	slog.Info("database upgraded", "from", currentSchemaVersion, "to", targetSchemaVersion, "scripts", migrationsApplied)
	return nil
}

func (s *Store) initializeSchema(ctx context.Context, target string) error {
	tx, err := s.driver.GetDB().BeginTx(ctx, nil)
	if err != nil {
		return errors.Wrap(err, "failed to start schema initialization")
	}
	defer tx.Rollback()
	if err := executeSQLFile(ctx, tx, migrationFS, s.getMigrationBasePath()+LatestSchemaFileName); err != nil {
		return err
	}
	return s.commitSchemaVersion(ctx, tx, &storepb.InstanceBasicSetting{}, target)
}

func (s *Store) getMigrationBasePath() string {
	return fmt.Sprintf("migration/%s/", s.profile.Driver)
}

func (s *Store) seed(ctx context.Context) error {
	filenames, err := fs.Glob(seedFS, "seed/sqlite/*.sql")
	if err != nil {
		return errors.Wrap(err, "failed to read seed files")
	}

	tx, err := s.driver.GetDB().BeginTx(ctx, nil)
	if err != nil {
		return errors.Wrap(err, "failed to start transaction")
	}
	defer tx.Rollback()
	// Loop over all seed files and execute them in order.
	for _, filename := range filenames {
		if err := executeSQLFile(ctx, tx, seedFS, filename); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetCurrentSchemaVersion returns the latest schema version available for the configured database driver.
func (s *Store) GetCurrentSchemaVersion() (string, error) {
	filePaths, err := fs.Glob(migrationFS, fmt.Sprintf("%s*/*.sql", s.getMigrationBasePath()))
	if err != nil {
		return "", errors.Wrap(err, "failed to read migration files")
	}
	currentSchemaVersion := "0.0.0"
	for _, filePath := range filePaths {
		fileSchemaVersion, err := getSchemaVersionOfMigrateScript(filePath)
		if err != nil {
			return "", errors.Wrap(err, "failed to get schema version of migrate script")
		}
		if compareSchemaVersions(fileSchemaVersion, currentSchemaVersion) > 0 {
			currentSchemaVersion = fileSchemaVersion
		}
	}
	return currentSchemaVersion, nil
}

// getSchemaVersionOfMigrateScript extracts the schema version from the migration script file path.
// It returns the schema version in the format "major.minor.patch".
func getSchemaVersionOfMigrateScript(filePath string) (string, error) {
	normalizedPath := filepath.ToSlash(filePath)
	elements := strings.Split(normalizedPath, "/")
	if len(elements) < 2 {
		return "", errors.Errorf("invalid file path: %s", filePath)
	}
	minorVersion := elements[len(elements)-2]
	rawPatchVersion, _, ok := strings.Cut(elements[len(elements)-1], MigrateFileNameSplit)
	if !ok {
		return "", errors.Errorf("invalid migration filename: %s", filePath)
	}
	patchVersion, err := strconv.Atoi(rawPatchVersion)
	if err != nil {
		return "", errors.Wrapf(err, "failed to convert patch version to int: %s", rawPatchVersion)
	}
	return fmt.Sprintf("%s.%d", minorVersion, patchVersion+1), nil
}

func executeSQLFile(ctx context.Context, tx *sql.Tx, files embed.FS, path string) error {
	stmt, err := files.ReadFile(path)
	if err != nil {
		return errors.Wrapf(err, "failed to read %s", path)
	}
	if _, err := tx.ExecContext(ctx, string(stmt)); err != nil {
		return errors.Wrapf(err, "failed to execute %s", path)
	}
	return nil
}

func (s *Store) commitSchemaVersion(ctx context.Context, tx *sql.Tx, basic *storepb.InstanceBasicSetting, version string) error {
	basic.SchemaVersion = version
	value, err := protojson.Marshal(basic)
	if err != nil {
		return errors.Wrap(err, "failed to marshal instance basic setting")
	}
	name := storepb.InstanceSettingKey_BASIC.String()
	if err := s.driver.UpsertInstanceSetting(ctx, tx, &InstanceSetting{Name: name, Value: string(value)}); err != nil {
		return errors.Wrap(err, "failed to record database schema version")
	}
	if err := tx.Commit(); err != nil {
		return errors.Wrap(err, "failed to commit database migration")
	}
	s.instanceSettingCache.Delete(ctx, name)
	return nil
}
