package test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
)

func TestAccessTokenStoreFailureIsNotUnauthenticated(t *testing.T) {
	ts := NewTestService(t)
	token, _, err := auth.GenerateAccessTokenV2(9999, "unavailable", "USER", "NORMAL", []byte(ts.Secret))
	require.NoError(t, err)
	require.NoError(t, ts.Store.Close())

	authenticator := auth.NewAuthenticator(ts.Store, ts.Secret)
	result, err := authenticator.Authenticate(context.Background(), "Bearer "+token)
	require.Nil(t, result)
	require.Error(t, err)
	require.True(t, auth.IsAuthenticationStoreError(err))
}

func TestRefreshTokenStoreFailureReturnsUnavailable(t *testing.T) {
	ts := NewTestService(t)
	refreshToken, _, err := auth.GenerateRefreshToken(9999, "test-token-id", []byte(ts.Secret))
	require.NoError(t, err)
	require.NoError(t, ts.Store.Close())

	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"cookie",
		fmt.Sprintf("%s=%s", auth.RefreshTokenCookieName, refreshToken),
	))
	_, err = ts.Service.RefreshToken(ctx, &v1pb.RefreshTokenRequest{})
	require.Error(t, err)
	require.Equal(t, codes.Unavailable, status.Code(err))
}

func TestGetCurrentUserStoreFailureReturnsUnavailable(t *testing.T) {
	ts := NewTestService(t)
	require.NoError(t, ts.Store.Close())

	ctx := auth.ApplyToContext(context.Background(), &auth.AuthResult{
		Claims: &auth.UserClaims{UserID: 9999},
	})
	_, err := ts.Service.GetCurrentUser(ctx, &v1pb.GetCurrentUserRequest{})
	require.Error(t, err)
	require.Equal(t, codes.Unavailable, status.Code(err))
}
