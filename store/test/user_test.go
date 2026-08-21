package test

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/usememos/memos/store"
)

func TestUserStore(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	username := user.Username
	users, err := ts.ListUsers(ctx, &store.FindUser{})
	require.NoError(t, err)
	require.Equal(t, 1, len(users))
	require.Equal(t, store.RoleAdmin, users[0].Role)
	require.Equal(t, user, users[0])
	userPatchNickname := "test_nickname_2"
	userPatch := &store.UpdateUser{
		ID:       user.ID,
		Nickname: &userPatchNickname,
	}
	user, err = ts.UpdateUser(ctx, userPatch)
	require.NoError(t, err)
	require.Equal(t, userPatchNickname, user.Nickname)
	_, err = ts.DeleteUser(ctx, &store.DeleteUser{
		ID: user.ID,
	})
	require.NoError(t, err)
	users, err = ts.ListUsers(ctx, &store.FindUser{})
	require.NoError(t, err)
	require.Equal(t, 0, len(users))
	deletedUser, err := ts.GetUser(ctx, &store.FindUser{Username: &username})
	require.NoError(t, err)
	require.Nil(t, deletedUser)
	ts.Close()
}

func TestUserListByIDList(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	// Create 5 users
	var userIDs []int32
	for i := 0; i < 5; i++ {
		user, err := createTestingUserWithRole(ctx, ts, fmt.Sprintf("user_list_%d", i), store.RoleUser)
		require.NoError(t, err)
		userIDs = append(userIDs, user.ID)
	}

	// List users by IDList (3 out of 5)
	targetIDs := userIDs[1:4]
	users, err := ts.ListUsers(ctx, &store.FindUser{IDList: targetIDs})
	require.NoError(t, err)
	require.Equal(t, 3, len(users))

	foundIDs := make(map[int32]bool)
	for _, u := range users {
		foundIDs[u.ID] = true
	}
	for _, id := range targetIDs {
		require.True(t, foundIDs[id])
	}

	ts.Close()
}

func TestUserGetByID(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// Get user by ID
	found, err := ts.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)
	require.NotNil(t, found)
	require.Equal(t, user.ID, found.ID)
	require.Equal(t, user.Username, found.Username)

	// Get non-existent user
	nonExistentID := int32(99999)
	notFound, err := ts.GetUser(ctx, &store.FindUser{ID: &nonExistentID})
	require.NoError(t, err)
	require.Nil(t, notFound)

	ts.Close()
}

func TestConcurrentUserCacheMissesAreCoalesced(t *testing.T) {
	t.Run("by ID", func(t *testing.T) {
		testConcurrentUserCacheMissesAreCoalesced(t, "singleflight-id", func(userID int32, _ string) *store.FindUser {
			return &store.FindUser{ID: &userID}
		})
	})
	t.Run("by username", func(t *testing.T) {
		testConcurrentUserCacheMissesAreCoalesced(t, "singleflight-username", func(_ int32, username string) *store.FindUser {
			return &store.FindUser{Username: &username}
		})
	})
}

func testConcurrentUserCacheMissesAreCoalesced(t *testing.T, username string, findUser func(int32, string) *store.FindUser) {
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	database := ts.GetDriver().GetDB()
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)
	userID := insertUserWithoutStoreCache(t, ctx, database, getDriverFromEnv(), username)

	connection, err := database.Conn(ctx)
	require.NoError(t, err)
	waitCountBefore := database.Stats().WaitCount

	const callers = 20
	start := make(chan struct{})
	errors := make(chan error, callers)
	var waitGroup sync.WaitGroup
	waitGroup.Add(callers)
	for range callers {
		go func() {
			defer waitGroup.Done()
			<-start
			user, err := ts.GetUser(ctx, findUser(userID, username))
			if err == nil && (user == nil || user.ID != userID) {
				err = fmt.Errorf("unexpected user result: %+v", user)
			}
			errors <- err
		}()
	}
	close(start)

	require.Eventually(t, func() bool {
		return database.Stats().WaitCount > waitCountBefore
	}, 2*time.Second, 10*time.Millisecond)
	require.NoError(t, connection.Close())
	waitGroup.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}

	require.Equal(t, waitCountBefore+1, database.Stats().WaitCount)
}

func insertUserWithoutStoreCache(t *testing.T, ctx context.Context, database interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, driver, username string) int32 {
	t.Helper()

	if driver == "postgres" {
		var userID int32
		err := database.QueryRowContext(ctx, `INSERT INTO "user" (username, password_hash, avatar_url) VALUES ($1, $2, $3) RETURNING id`, username, "hash", "").Scan(&userID)
		require.NoError(t, err)
		return userID
	}

	table := "user"
	if driver == "mysql" {
		table = "`user`"
	}
	result, err := database.ExecContext(ctx, fmt.Sprintf("INSERT INTO %s (username, password_hash, avatar_url) VALUES (?, ?, ?)", table), username, "hash", "")
	require.NoError(t, err)
	userID, err := result.LastInsertId()
	require.NoError(t, err)
	return int32(userID)
}

func TestUserGetByUsername(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	// Get user by username
	found, err := ts.GetUser(ctx, &store.FindUser{Username: &user.Username})
	require.NoError(t, err)
	require.NotNil(t, found)
	require.Equal(t, user.Username, found.Username)

	// Get non-existent username
	nonExistent := "nonexistent"
	notFound, err := ts.GetUser(ctx, &store.FindUser{Username: &nonExistent})
	require.NoError(t, err)
	require.Nil(t, notFound)

	ts.Close()
}

func TestListUsersByIDsUsesCache(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	first, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	second, err := createTestingUserWithRole(ctx, ts, "cached-user", store.RoleUser)
	require.NoError(t, err)
	require.NoError(t, ts.GetDriver().GetDB().Close())

	users, err := ts.ListUsersByIDs(ctx, []int32{second.ID, first.ID, second.ID})
	require.NoError(t, err)
	require.Len(t, users, 2)
	require.Equal(t, second.ID, users[0].ID)
	require.Equal(t, first.ID, users[1].ID)
}

func TestUsernameEqualityIsCaseSensitive(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	upper, err := createTestingUserWithRole(ctx, ts, "Alice", store.RoleUser)
	require.NoError(t, err)
	lower, err := createTestingUserWithRole(ctx, ts, "alice", store.RoleUser)
	require.NoError(t, err)
	require.NotEqual(t, upper.ID, lower.ID)

	for username, wantID := range map[string]int32{
		"Alice": upper.ID,
		"alice": lower.ID,
	} {
		found, err := ts.GetUser(ctx, &store.FindUser{Username: &username})
		require.NoError(t, err)
		require.Equal(t, wantID, found.ID)

		listed, err := ts.ListUsers(ctx, &store.FindUser{UsernameList: []string{username}})
		require.NoError(t, err)
		require.Len(t, listed, 1)
		require.Equal(t, wantID, listed[0].ID)
	}
}

func TestUserListByRole(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	// Create users with different roles
	_, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	_, err = createTestingUserWithRole(ctx, ts, "admin_user", store.RoleAdmin)
	require.NoError(t, err)

	regularUser, err := createTestingUserWithRole(ctx, ts, "regular_user", store.RoleUser)
	require.NoError(t, err)

	// List all users
	allUsers, err := ts.ListUsers(ctx, &store.FindUser{})
	require.NoError(t, err)
	require.Equal(t, 3, len(allUsers))

	// List only ADMIN users
	adminRole := store.RoleAdmin
	adminOnlyUsers, err := ts.ListUsers(ctx, &store.FindUser{Role: &adminRole})
	require.NoError(t, err)
	require.Equal(t, 2, len(adminOnlyUsers))

	// List only USER role users
	userRole := store.RoleUser
	regularUsers, err := ts.ListUsers(ctx, &store.FindUser{Role: &userRole})
	require.NoError(t, err)
	require.Equal(t, 1, len(regularUsers))
	require.Equal(t, regularUser.ID, regularUsers[0].ID)

	ts.Close()
}

func TestUserUpdateRowStatus(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	require.Equal(t, store.Normal, user.RowStatus)

	// Archive user
	archivedStatus := store.Archived
	updated, err := ts.UpdateUser(ctx, &store.UpdateUser{
		ID:        user.ID,
		RowStatus: &archivedStatus,
	})
	require.NoError(t, err)
	require.Equal(t, store.Archived, updated.RowStatus)

	// Verify by fetching
	fetched, err := ts.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)
	require.Equal(t, store.Archived, fetched.RowStatus)

	// Restore to normal
	normalStatus := store.Normal
	restored, err := ts.UpdateUser(ctx, &store.UpdateUser{
		ID:        user.ID,
		RowStatus: &normalStatus,
	})
	require.NoError(t, err)
	require.Equal(t, store.Normal, restored.RowStatus)

	ts.Close()
}

func TestUserUpdateAllFields(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)
	previousUsername := user.Username

	// Update all fields
	newUsername := "updated_username"
	newEmail := "updated@test.com"
	newNickname := "Updated Nickname"
	newAvatarURL := "https://example.com/avatar.png"
	newDescription := "Updated description"
	newRole := store.RoleAdmin
	newPasswordHash := "new_password_hash"

	updated, err := ts.UpdateUser(ctx, &store.UpdateUser{
		ID:           user.ID,
		Username:     &newUsername,
		Email:        &newEmail,
		Nickname:     &newNickname,
		AvatarURL:    &newAvatarURL,
		Description:  &newDescription,
		Role:         &newRole,
		PasswordHash: &newPasswordHash,
	})
	require.NoError(t, err)
	require.Equal(t, newUsername, updated.Username)
	require.Equal(t, newEmail, updated.Email)
	require.Equal(t, newNickname, updated.Nickname)
	require.Equal(t, newAvatarURL, updated.AvatarURL)
	require.Equal(t, newDescription, updated.Description)
	require.Equal(t, newRole, updated.Role)
	require.Equal(t, newPasswordHash, updated.PasswordHash)

	// Verify by fetching again
	fetched, err := ts.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)
	require.Equal(t, newUsername, fetched.Username)
	previousUser, err := ts.GetUser(ctx, &store.FindUser{Username: &previousUsername})
	require.NoError(t, err)
	require.Nil(t, previousUser)
	updatedByUsername, err := ts.GetUser(ctx, &store.FindUser{Username: &newUsername})
	require.NoError(t, err)
	require.Equal(t, user.ID, updatedByUsername.ID)

	ts.Close()
}

func TestUserListWithLimit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)

	// Create 5 users
	for i := 0; i < 5; i++ {
		role := store.RoleUser
		if i == 0 {
			role = store.RoleAdmin
		}
		_, err := createTestingUserWithRole(ctx, ts, fmt.Sprintf("user%d", i), role)
		require.NoError(t, err)
	}

	// List with limit
	limit := 3
	users, err := ts.ListUsers(ctx, &store.FindUser{Limit: &limit})
	require.NoError(t, err)
	require.Equal(t, 3, len(users))

	ts.Close()
}

func createTestingHostUser(ctx context.Context, ts *store.Store) (*store.User, error) {
	return createTestingUserWithRole(ctx, ts, "test", store.RoleAdmin)
}

func createTestingUserWithRole(ctx context.Context, ts *store.Store, username string, role store.Role) (*store.User, error) {
	userCreate := &store.User{
		Username:    username,
		Role:        role,
		Email:       username + "@test.com",
		Nickname:    username + "_nickname",
		Description: username + "_description",
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte("test_password"), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	userCreate.PasswordHash = string(passwordHash)
	user, err := ts.CreateUser(ctx, userCreate)
	return user, err
}
