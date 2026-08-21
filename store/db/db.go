package db

import (
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/db/mysql"
	"github.com/usememos/memos/store/db/postgres"
	"github.com/usememos/memos/store/db/sqlite"
)

// NewDBDriver creates new db driver based on profile.
func NewDBDriver(profile *profile.Profile) (store.Driver, error) {
	var driver store.Driver
	var err error

	switch profile.Driver {
	case "sqlite":
		driver, err = sqlite.NewDB(profile)
	case "mysql":
		driver, err = mysql.NewDB(profile)
	case "postgres":
		driver, err = postgres.NewDB(profile)
	default:
		return nil, errors.New("unknown db driver")
	}
	if err != nil {
		return nil, errors.Wrap(err, "failed to create db driver")
	}
	configureConnectionPool(driver, profile)
	return driver, nil
}

func configureConnectionPool(driver store.Driver, profile *profile.Profile) {
	// SQLite is an embedded database. The external database pool settings are
	// intended for MySQL and PostgreSQL, where unbounded pools can exhaust a
	// managed database's connection quota when multiple application instances run.
	if profile.Driver == "sqlite" {
		return
	}

	database := driver.GetDB()
	if profile.DBMaxOpenConns > 0 {
		database.SetMaxOpenConns(profile.DBMaxOpenConns)
	}
	database.SetMaxIdleConns(profile.DBMaxIdleConns)
	database.SetConnMaxIdleTime(5 * time.Minute)
}
