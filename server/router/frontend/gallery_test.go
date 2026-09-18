package frontend

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	apiv1test "github.com/usememos/memos/server/router/api/v1/test"
	"github.com/usememos/memos/server/router/fileserver"
	"github.com/usememos/memos/store"
)

type galleryFixture struct {
	service *apiv1test.TestService
	echo    *echo.Echo
	owner   *store.User
	other   *store.User
	admin   *store.User
}

func newGalleryFixture(t *testing.T) *galleryFixture {
	t.Helper()
	service := apiv1test.NewTestService(t)
	t.Cleanup(service.Cleanup)
	owner, err := service.CreateRegularUser(context.Background(), "photo-owner")
	require.NoError(t, err)
	other, err := service.CreateRegularUser(context.Background(), "photo-reader")
	require.NoError(t, err)
	admin, err := service.CreateHostUser(context.Background(), "photo-admin")
	require.NoError(t, err)
	e := echo.New()
	frontend := NewFrontendService(service.Profile, service.Store)
	frontend.Serve(context.Background(), e)
	frontend.RegisterGalleryRoutes(e, service.Service)
	fileserver.NewFileServerService(service.Profile, service.Store, service.Secret).RegisterRoutes(e)
	return &galleryFixture{service: service, echo: e, owner: owner, other: other, admin: admin}
}

func (f *galleryFixture) photo(t *testing.T, uid string, visibility store.Visibility) *store.Memo {
	t.Helper()
	ctx := context.Background()
	memo, err := f.service.Store.CreateMemo(ctx, &store.Memo{
		UID: "memo-" + uid, CreatorID: f.owner.ID, Content: "Photograph " + uid,
		Visibility: visibility, Payload: &storepb.MemoPayload{Tags: []string{"landscape"}},
	})
	require.NoError(t, err)
	aperture := 2.8
	var original bytes.Buffer
	require.NoError(t, jpeg.Encode(&original, image.NewRGBA(image.Rect(0, 0, 2, 2)), nil))
	_, err = f.service.Store.CreateAttachment(ctx, &store.Attachment{
		UID: uid, CreatorID: f.owner.ID, MemoID: &memo.ID, Filename: uid + ".jpg", Type: "image/jpeg",
		Blob: original.Bytes(),
		Payload: &storepb.AttachmentPayload{MediaMetadata: &storepb.MediaMetadata{
			Details: &storepb.MediaMetadata_Photo{Photo: &storepb.PhotoMetadata{CameraModel: "X-T5", FNumber: &aperture}},
		}},
	})
	require.NoError(t, err)
	return memo
}

func (f *galleryFixture) request(t *testing.T, path string, viewer *store.User) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if viewer != nil {
		token, _, err := auth.GenerateAccessTokenV2(viewer.ID, viewer.Username, string(viewer.Role), string(viewer.RowStatus), []byte(f.service.Secret))
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	f.echo.ServeHTTP(rec, req)
	require.Equal(t, "private, no-store", rec.Header().Get("Cache-Control"))
	return rec
}

func TestGalleryMemoVisibilityAcrossJSONAndSSR(t *testing.T) {
	f := newGalleryFixture(t)
	f.photo(t, "public-photo", store.Public)
	f.photo(t, "protected-photo", store.Protected)
	f.photo(t, "private-photo", store.Private)
	for _, tt := range []struct {
		name   string
		viewer *store.User
		uid    string
		status int
	}{
		{"anonymous public", nil, "public-photo", 200},
		{"anonymous protected", nil, "protected-photo", 401},
		{"anonymous private", nil, "private-photo", 401},
		{"owner private", f.owner, "private-photo", 200},
		{"other private", f.other, "private-photo", 403},
		{"admin private is not a bypass", f.admin, "private-photo", 403},
		{"signed in protected", f.other, "protected-photo", 200},
		{"missing photo", nil, "missing-photo", 404},
	} {
		t.Run(tt.name, func(t *testing.T) {
			for _, prefix := range []string{"/gallery/photos/", "/api/v1/gallery/photos/"} {
				rec := f.request(t, prefix+tt.uid, tt.viewer)
				require.Equal(t, tt.status, rec.Code)
				if tt.status != http.StatusOK {
					require.NotContains(t, rec.Body.String(), "X-T5")
					require.NotContains(t, rec.Body.String(), "og:image")
				}
			}
		})
	}
	rec := f.request(t, "/gallery/photos/public-photo", nil)
	require.Contains(t, rec.Body.String(), `<img src="/file/attachments/public-photo/public-photo.jpg?thumbnail=true"`)
	require.Contains(t, rec.Body.String(), "X-T5")
	require.Contains(t, rec.Body.String(), "f/2.8")
	require.Contains(t, rec.Body.String(), `property="og:image"`)
	require.Contains(t, rec.Body.String(), `http://localhost:8080/file/attachments/public-photo/public-photo.jpg?thumbnail=true`)
}

func TestGalleryFiltersPaginationAndWholeMemoChanges(t *testing.T) {
	f := newGalleryFixture(t)
	public := f.photo(t, "shared-one", store.Public)
	_, err := f.service.Store.CreateAttachment(context.Background(), &store.Attachment{
		UID: "shared-two", CreatorID: f.owner.ID, MemoID: &public.ID, Filename: "second.jpg", Type: "image/jpeg",
	})
	require.NoError(t, err)
	f.photo(t, "own-private", store.Private)
	f.photo(t, "protected", store.Protected)
	decode := func(path string, viewer *store.User) ([]json.RawMessage, string) {
		rec := f.request(t, path, viewer)
		require.Equal(t, 200, rec.Code)
		var result struct {
			Photos []json.RawMessage `json:"photos"`
			Next   string            `json:"nextPageToken"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &result))
		return result.Photos, result.Next
	}
	photos, _ := decode("/api/v1/gallery/photos?visibility=PUBLIC&tag=landscape", nil)
	require.Len(t, photos, 2)
	photos, _ = decode("/api/v1/gallery/photos?visibility=PRIVATE", f.other)
	require.Empty(t, photos)
	photos, _ = decode("/api/v1/gallery/photos?visibility=PRIVATE", f.owner)
	require.Len(t, photos, 1)
	private := store.Private
	require.NoError(t, f.service.Store.UpdateMemo(context.Background(), &store.UpdateMemo{ID: public.ID, Visibility: &private}))
	photos, _ = decode("/api/v1/gallery/photos?visibility=PUBLIC", nil)
	require.Empty(t, photos)
	for _, uid := range []string{"shared-one", "shared-two"} {
		require.Equal(t, 401, f.request(t, "/gallery/photos/"+uid, nil).Code)
		require.Equal(t, 200, f.request(t, "/gallery/photos/"+uid, f.owner).Code)
	}
	for i := range 22 {
		f.photo(t, "paged-"+string(rune('a'+i)), store.Public)
	}
	photos, token := decode("/api/v1/gallery/photos?visibility=PUBLIC", nil)
	require.Len(t, photos, 20)
	require.NotEmpty(t, token)
	photos, token = decode("/api/v1/gallery/photos?visibility=PUBLIC&pageToken="+url.QueryEscape(token), nil)
	require.Len(t, photos, 2)
	require.Empty(t, token)
	require.Equal(t, 400, f.request(t, "/api/v1/gallery/photos?pageToken=invalid", nil).Code)
}

func TestGalleryShareScopeRevocationAndPrivateInstance(t *testing.T) {
	f := newGalleryFixture(t)
	memo := f.photo(t, "private-shared", store.Private)
	f.photo(t, "other-memo", store.Private)
	ctx := f.service.CreateUserContext(context.Background(), f.owner.ID)
	share, err := f.service.Service.CreateMemoShare(ctx, &v1pb.CreateMemoShareRequest{Parent: "memos/" + memo.UID})
	require.NoError(t, err)
	token := share.Name[strings.LastIndex(share.Name, "/")+1:]
	f.service.Profile.InstanceURL = ""
	require.Equal(t, 401, f.request(t, "/api/v1/gallery/photos", nil).Code)
	for _, prefix := range []string{"/gallery/photos/", "/api/v1/gallery/photos/"} {
		rec := f.request(t, prefix+"private-shared?share_token="+token, nil)
		require.Equal(t, 200, rec.Code)
		require.Equal(t, "no-referrer", rec.Header().Get("Referrer-Policy"))
		require.Equal(t, 404, f.request(t, prefix+"other-memo?share_token="+token, nil).Code)
	}
	rec := f.request(t, "/gallery/photos/private-shared?share_token="+token, nil)
	require.Equal(t, "noindex, nofollow, noarchive", rec.Header().Get("X-Robots-Tag"))
	require.Contains(t, rec.Body.String(), "share_token="+token)
	for _, suffix := range []string{"", "&thumbnail=true"} {
		request := httptest.NewRequest(http.MethodGet, "/file/attachments/private-shared/private-shared.jpg?share_token="+token+suffix, nil)
		recorder := httptest.NewRecorder()
		f.echo.ServeHTTP(recorder, request)
		require.Equal(t, 200, recorder.Code)
		require.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
		require.NotEmpty(t, recorder.Body.Bytes())
	}
	_, err = f.service.Service.DeleteMemoShare(ctx, &v1pb.DeleteMemoShareRequest{Name: share.Name})
	require.NoError(t, err)
	require.Equal(t, 404, f.request(t, "/gallery/photos/private-shared?share_token="+token, nil).Code)
	for _, suffix := range []string{"", "&thumbnail=true"} {
		request := httptest.NewRequest(http.MethodGet, "/file/attachments/private-shared/private-shared.jpg?share_token="+token+suffix, nil)
		recorder := httptest.NewRecorder()
		f.echo.ServeHTTP(recorder, request)
		require.Equal(t, 401, recorder.Code)
		require.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
	}
	expiredSec := time.Now().Add(-time.Hour).Unix()
	_, err = f.service.Store.CreateMemoShare(ctx, &store.MemoShare{UID: "expired-share", MemoID: memo.ID, CreatorID: f.owner.ID, ExpiresTs: &expiredSec})
	require.NoError(t, err)
	require.Equal(t, 404, f.request(t, "/api/v1/gallery/photos/private-shared?share_token=expired-share", nil).Code)
}

func TestGalleryArchivedCommentsAndOrphans(t *testing.T) {
	f := newGalleryFixture(t)
	memo := f.photo(t, "archived-photo", store.Public)
	archived := store.Archived
	require.NoError(t, f.service.Store.UpdateMemo(context.Background(), &store.UpdateMemo{ID: memo.ID, RowStatus: &archived}))
	require.Equal(t, 404, f.request(t, "/gallery/photos/archived-photo", nil).Code)
	require.Equal(t, 200, f.request(t, "/gallery/photos/archived-photo", f.owner).Code)
	ctx := context.Background()
	parent := f.photo(t, "parent-photo", store.Public)
	comment := f.photo(t, "comment-photo", store.Public)
	_, err := f.service.Store.UpsertMemoRelation(ctx, &store.MemoRelation{MemoID: comment.ID, RelatedMemoID: parent.ID, Type: store.MemoRelationComment})
	require.NoError(t, err)
	_, err = f.service.Store.CreateAttachment(ctx, &store.Attachment{UID: "orphan-photo", CreatorID: f.owner.ID, Filename: "orphan.jpg", Type: "image/jpeg"})
	require.NoError(t, err)
	for _, uid := range []string{"comment-photo", "orphan-photo"} {
		require.Equal(t, 404, f.request(t, "/gallery/photos/"+uid, f.owner).Code)
	}
	rec := f.request(t, "/api/v1/gallery/photos", f.owner)
	require.NotContains(t, rec.Body.String(), "attachments/comment-photo")
	require.NotContains(t, rec.Body.String(), "orphan-photo")
	require.NotContains(t, rec.Body.String(), "archived-photo")
	rec = f.request(t, "/api/v1/gallery/photos?state=ARCHIVED", f.owner)
	require.Contains(t, rec.Body.String(), "archived-photo")
}

func TestGalleryEmptyMemoPageAndPublicSitemap(t *testing.T) {
	f := newGalleryFixture(t)
	f.photo(t, "old-photo", store.Public)
	f.photo(t, "hidden-photo", store.Private)
	ctx := context.Background()
	for i := range 20 {
		_, err := f.service.Store.CreateMemo(ctx, &store.Memo{
			UID: "text-" + string(rune('a'+i)), CreatorID: f.owner.ID, Content: "No attachments", Visibility: store.Public,
		})
		require.NoError(t, err)
	}
	rec := f.request(t, "/api/v1/gallery/photos", nil)
	require.Equal(t, 200, rec.Code)
	var page struct {
		Photos []json.RawMessage `json:"photos"`
		Next   string            `json:"nextPageToken"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &page))
	require.Empty(t, page.Photos)
	require.NotEmpty(t, page.Next)
	rec = f.request(t, "/gallery", nil)
	require.Contains(t, rec.Body.String(), "Next page")
	rec = f.request(t, "/api/v1/gallery/photos?pageToken="+url.QueryEscape(page.Next), nil)
	require.Contains(t, rec.Body.String(), "attachments/old-photo")
	request := httptest.NewRequest(http.MethodGet, "/sitemap.xml", nil)
	recorder := httptest.NewRecorder()
	f.echo.ServeHTTP(recorder, request)
	require.Equal(t, 200, recorder.Code)
	require.Contains(t, recorder.Body.String(), "/gallery/photos/old-photo")
	require.NotContains(t, recorder.Body.String(), "hidden-photo")
}

func TestGalleryRefreshCookieAndEscapedSSRContent(t *testing.T) {
	f := newGalleryFixture(t)
	memo := f.photo(t, "script-photo", store.Private)
	content := `</script><script>alert(1)</script>`
	require.NoError(t, f.service.Store.UpdateMemo(context.Background(), &store.UpdateMemo{ID: memo.ID, Content: &content}))
	ctx := context.Background()
	token, expires, err := auth.GenerateRefreshToken(f.owner.ID, "gallery-session", []byte(f.service.Secret))
	require.NoError(t, err)
	require.NoError(t, f.service.Store.AddUserRefreshToken(ctx, f.owner.ID, &storepb.RefreshTokensUserSetting_RefreshToken{
		TokenId: "gallery-session", ExpiresAt: timestamppb.New(expires),
	}))
	req := httptest.NewRequest(http.MethodGet, "/gallery/photos/script-photo", nil)
	req.AddCookie(&http.Cookie{Name: auth.RefreshTokenCookieName, Value: token})
	req.Header.Set("X-Forwarded-Host", "attacker.example")
	rec := httptest.NewRecorder()
	f.echo.ServeHTTP(rec, req)
	require.Equal(t, 200, rec.Code)
	require.NotContains(t, rec.Body.String(), "<script>alert(1)</script>")
	require.NotContains(t, rec.Body.String(), "attacker.example")
	require.Equal(t, "private, no-store", rec.Header().Get("Cache-Control"))
}
