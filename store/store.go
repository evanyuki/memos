package store

import (
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/storage"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store/cache"
)

// Store provides database access to all raw objects.
type Store struct {
	profile *profile.Profile
	driver  Driver

	userCreateMu   sync.Mutex
	authConfigMu   sync.Mutex
	refreshTokenMu sync.Mutex
	patMu          sync.Mutex
	memoViewMu     sync.Mutex
	userLoadGroup  singleflight.Group

	deploymentConfigMu sync.RWMutex
	deploymentConfig   *deploymentConfiguration

	// Cache settings
	cacheConfig cache.Config

	// Caches
	instanceSettingCache *cache.Cache // cache for instance settings
	userCache            *cache.Cache // cache for users
	userSettingCache     *cache.Cache // cache for user settings

	// storageDriverCache reuses object-storage clients across requests, keyed
	// by the resolved configuration. Reset whenever the STORAGE setting changes.
	storageDriverMu         sync.Mutex
	storageDriverGeneration uint64
	storageDriverCache      map[storageDriverCacheKey]storage.Driver

	databasePoolStatsStop chan struct{}
}

type deploymentConfiguration struct {
	identityProviders map[string]*storepb.IdentityProvider
	instanceSettings  map[storepb.InstanceSettingKey]*storepb.InstanceSetting
}

// New creates a new instance of Store.
func New(driver Driver, profile *profile.Profile) *Store {
	// Default cache settings
	cacheConfig := cache.Config{
		DefaultTTL:      10 * time.Minute,
		CleanupInterval: 5 * time.Minute,
		MaxItems:        1000,
		OnEviction:      nil,
	}

	store := &Store{
		driver:               driver,
		profile:              profile,
		cacheConfig:          cacheConfig,
		instanceSettingCache: cache.New(cacheConfig),
		userCache:            cache.New(cacheConfig),
		userSettingCache:     cache.New(cacheConfig),
		deploymentConfig: &deploymentConfiguration{
			identityProviders: map[string]*storepb.IdentityProvider{},
			instanceSettings:  map[storepb.InstanceSettingKey]*storepb.InstanceSetting{},
		},
	}
	if profile.Driver != "sqlite" {
		store.databasePoolStatsStop = make(chan struct{})
		go store.logDatabasePoolStats()
	}

	return store
}

func (s *Store) GetDriver() Driver {
	return s.driver
}

// GetDataDir returns the store data directory.
func (s *Store) GetDataDir() string {
	return s.profile.Data
}

func (s *Store) Close() error {
	if s.databasePoolStatsStop != nil {
		close(s.databasePoolStatsStop)
	}
	// Stop all cache cleanup goroutines
	s.instanceSettingCache.Close()
	s.userCache.Close()
	s.userSettingCache.Close()

	return s.driver.Close()
}
