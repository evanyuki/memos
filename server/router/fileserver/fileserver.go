package fileserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"
	"golang.org/x/sync/semaphore"
	"golang.org/x/sync/singleflight"

	"github.com/usememos/memos/internal/photomedia"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/storage"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/access"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// Constants for file serving configuration.
const (
	// maxConcurrentThumbnails limits concurrent thumbnail generation to prevent memory exhaustion.
	maxConcurrentThumbnails = 3

	// cacheMaxAge is the max-age value for Cache-Control headers (1 hour).
	cacheMaxAge = "public, max-age=3600"

	publicAttachmentCacheControl  = "public, max-age=300, s-maxage=300, must-revalidate"
	privateAttachmentCacheControl = "private, no-store"
)

// xssUnsafeTypes contains MIME types that could execute scripts if served directly.
// These are served as application/octet-stream to prevent XSS attacks.
var xssUnsafeTypes = map[string]bool{
	"text/html":                true,
	"text/javascript":          true,
	"application/javascript":   true,
	"application/x-javascript": true,
	"text/xml":                 true,
	"application/xml":          true,
	"application/xhtml+xml":    true,
}

// avatarAllowedTypes contains MIME types allowed for user avatars.
var avatarAllowedTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/jpg":  true,
	"image/gif":  true,
	"image/webp": true,
	"image/heic": true,
	"image/heif": true,
}

// dataURIRegex parses data URI format: data:image/png;base64,iVBORw0KGgo...
var dataURIRegex = regexp.MustCompile(`^data:(?P<type>[^;]+);base64,(?P<base64>.+)`)

// FileServerService handles HTTP file serving with proper range request support.
type FileServerService struct {
	Profile       *profile.Profile
	Store         *store.Store
	authenticator *auth.Authenticator

	// thumbnailSemaphore limits concurrent thumbnail generation.
	thumbnailSemaphore *semaphore.Weighted
	thumbnailGroup     singleflight.Group
}

// NewFileServerService creates a new file server service.
func NewFileServerService(profile *profile.Profile, store *store.Store, secret string) *FileServerService {
	return &FileServerService{
		Profile:            profile,
		Store:              store,
		authenticator:      auth.NewAuthenticator(store, secret),
		thumbnailSemaphore: semaphore.NewWeighted(maxConcurrentThumbnails),
	}
}

// RegisterRoutes registers HTTP file serving routes.
func (s *FileServerService) RegisterRoutes(echoServer *echo.Echo) {
	fileGroup := echoServer.Group("/file")
	fileGroup.GET("/attachments/:uid", s.serveAttachmentFile)
	fileGroup.GET("/attachments/:uid/:filename", s.serveAttachmentFile)
	fileGroup.GET("/users/:identifier/avatar", s.serveUserAvatar)
}

// =============================================================================
// HTTP Handlers
// =============================================================================

// serveAttachmentFile serves attachment binary content using native HTTP.
func (s *FileServerService) serveAttachmentFile(c *echo.Context) error {
	ctx := c.Request().Context()
	c.Response().Header().Set(echo.HeaderCacheControl, privateAttachmentCacheControl)
	uid := c.Param("uid")
	wantThumbnail := c.QueryParam("thumbnail") == "true"
	wantMotion := c.QueryParam("motion") == "true"

	attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{
		UID:     &uid,
		GetBlob: false,
	})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get attachment").Wrap(err)
	}
	if attachment == nil {
		return echo.NewHTTPError(http.StatusNotFound, "attachment not found")
	}

	readClass, err := s.checkAttachmentPermission(ctx, c, attachment)
	if err != nil {
		return err
	}
	cameraMedia := attachment.IsCameraMedia()
	public := readClass == access.MemoReadClassPublic && c.QueryParam("share_token") == ""
	if c.QueryParam("original") == "true" {
		if !cameraMedia || wantThumbnail || wantMotion {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid original selector")
		}
		if err := s.checkOriginalPermission(ctx, c, attachment); err != nil {
			return err
		}
		c.Response().Header().Set(echo.HeaderContentDisposition, mime.FormatMediaType("attachment", map[string]string{"filename": attachment.Filename}))
	} else if cameraMedia {
		variant := photomedia.Display
		switch {
		case wantThumbnail:
			variant = photomedia.Thumbnail
		case wantMotion || attachment.Payload.GetMotionMedia().GetRole() == storepb.MotionMediaRole_VIDEO:
			variant = photomedia.Motion
		}
		return s.servePhoto(ctx, c, attachment, variant, public)
	} else if wantMotion || wantThumbnail {
		return echo.NewHTTPError(http.StatusNotFound, "no image preview")
	} else if public {
		c.Response().Header().Set(echo.HeaderCacheControl, publicAttachmentCacheControl)
	}

	contentType := sanitizeContentType(attachment.Type)

	// Stream video/audio to avoid loading entire file into memory.
	if isMediaType(attachment.Type) {
		return s.serveMediaStream(c, attachment, contentType)
	}

	return s.serveStaticFile(c, attachment, contentType)
}

// serveUserAvatar serves user avatar images.
func (s *FileServerService) serveUserAvatar(c *echo.Context) error {
	ctx := c.Request().Context()

	// On a private instance (no InstanceURL), avatars are not exposed to anonymous
	// visitors; a valid session, access token, or PAT is required.
	if !s.Profile.AllowAnonymous() {
		viewer, err := s.getCurrentUser(ctx, c)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to get current user").Wrap(err)
		}
		if viewer == nil {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized access")
		}
	}

	identifier := c.Param("identifier")

	user, err := s.Store.GetUser(ctx, &store.FindUser{Username: &identifier})
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get user").Wrap(err)
	}
	if user == nil {
		return echo.NewHTTPError(http.StatusNotFound, "user not found")
	}
	if user.AvatarURL == "" {
		return echo.NewHTTPError(http.StatusNotFound, "avatar not found")
	}

	imageType, imageData, err := parseDataURI(user.AvatarURL)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to parse avatar data").Wrap(err)
	}

	if !avatarAllowedTypes[imageType] {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid avatar image type")
	}

	setSecurityHeaders(c)
	c.Response().Header().Set(echo.HeaderCacheControl, cacheMaxAge)

	return c.Blob(http.StatusOK, imageType, imageData)
}

// =============================================================================
// File Serving Methods
// =============================================================================

// serveMediaStream serves video/audio files using streaming to avoid memory exhaustion.
func (s *FileServerService) serveMediaStream(c *echo.Context, attachment *store.Attachment, contentType string) error {
	setSecurityHeaders(c)
	setMediaHeaders(c, contentType, attachment.Type)

	switch attachment.StorageType {
	case storepb.AttachmentStorageType_LOCAL:
		http.ServeFile(c.Response(), c.Request(), s.resolveLocalPath(attachment.Reference))
		return nil

	case storepb.AttachmentStorageType_S3:
		return s.streamS3Object(c, attachment, contentType)

	default:
		// Database storage fallback.
		blob, err := s.getAttachmentBlob(c.Request().Context(), attachment)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read attachment").Wrap(err)
		}
		modTime := time.Unix(attachment.UpdatedTs, 0)
		http.ServeContent(c.Response(), c.Request(), attachment.Filename, modTime, bytes.NewReader(blob))
		return nil
	}
}

// serveStaticFile serves non-streaming files (images, documents, etc.).
func (s *FileServerService) serveStaticFile(c *echo.Context, attachment *store.Attachment, contentType string) error {
	setSecurityHeaders(c)
	setMediaHeaders(c, contentType, attachment.Type)

	// Force download for non-media files to prevent XSS execution.
	if !strings.HasPrefix(contentType, "image/") && contentType != "application/pdf" {
		c.Response().Header().Set(echo.HeaderContentDisposition, fmt.Sprintf("attachment; filename=%q", attachment.Filename))
	}

	switch attachment.StorageType {
	case storepb.AttachmentStorageType_LOCAL:
		http.ServeFile(c.Response(), c.Request(), s.resolveLocalPath(attachment.Reference))
		return nil
	case storepb.AttachmentStorageType_S3:
		return s.streamS3Object(c, attachment, contentType)
	default:
		blob, err := s.getAttachmentBlob(c.Request().Context(), attachment)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to read attachment").Wrap(err)
		}
		return c.Blob(http.StatusOK, contentType, blob)
	}
}

// =============================================================================
// Storage Operations
// =============================================================================

// getAttachmentBlob retrieves the binary content of an attachment from storage.
func (s *FileServerService) getAttachmentBlob(ctx context.Context, attachment *store.Attachment) ([]byte, error) {
	if attachment.StorageType != storepb.AttachmentStorageType_LOCAL && attachment.StorageType != storepb.AttachmentStorageType_S3 && attachment.Blob != nil {
		return attachment.Blob, nil
	}
	reader, err := s.getAttachmentReader(ctx, attachment)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	blob, err := io.ReadAll(reader)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read attachment content")
	}
	return blob, nil
}

// getAttachmentReader returns a reader for streaming attachment content.
func (s *FileServerService) getAttachmentReader(ctx context.Context, attachment *store.Attachment) (io.ReadCloser, error) {
	switch attachment.StorageType {
	case storepb.AttachmentStorageType_LOCAL:
		file, err := os.Open(s.resolveLocalPath(attachment.Reference))
		if err != nil {
			if os.IsNotExist(err) {
				return nil, errors.Wrap(err, "file not found")
			}
			return nil, errors.Wrap(err, "failed to open file")
		}
		return file, nil

	case storepb.AttachmentStorageType_S3:
		driver, s3Object, err := s.Store.ResolveAttachmentS3Driver(ctx, attachment)
		if err != nil {
			return nil, err
		}
		object, err := driver.GetObjectStream(ctx, s3Object.Key, "")
		if err != nil {
			return nil, errors.Wrap(err, "failed to stream from S3")
		}
		return object.Body, nil

	default:
		blob := attachment.Blob
		if blob == nil {
			stored, err := s.Store.GetAttachment(ctx, &store.FindAttachment{ID: &attachment.ID, GetBlob: true})
			if err != nil {
				return nil, errors.Wrap(err, "failed to load attachment content")
			}
			if stored == nil {
				return nil, errors.New("attachment not found")
			}
			blob = stored.Blob
		}
		return io.NopCloser(bytes.NewReader(blob)), nil
	}
}

// resolveLocalPath converts a storage reference to an absolute file path.
func (s *FileServerService) resolveLocalPath(reference string) string {
	filePath := filepath.FromSlash(reference)
	if !filepath.IsAbs(filePath) {
		filePath = filepath.Join(s.Profile.Data, filePath)
	}
	return filePath
}

// streamS3Object streams S3 content through the server, forwarding a supported
// single Range so media players and document viewers can seek without a direct
// S3 URL. Multipart ranges are ignored and served as a complete response
// because S3 does not support multipart range responses.
func (s *FileServerService) streamS3Object(c *echo.Context, attachment *store.Attachment, contentType string) error {
	ctx := c.Request().Context()
	driver, s3Object, err := s.Store.ResolveAttachmentS3Driver(ctx, attachment)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to resolve S3 attachment driver").Wrap(err)
	}

	object, err := driver.GetObjectStream(ctx, s3Object.Key, singleRangeHeader(c.Request().Header))
	if err != nil {
		return objectStreamError(c, err)
	}
	return sendObjectStream(c, object, contentType)
}

func objectStreamError(c *echo.Context, err error) error {
	if errors.Is(err, storage.ErrRangeNotSatisfiable) {
		h := c.Response().Header()
		h.Set("Accept-Ranges", "bytes")
		var rangeErr *storage.RangeNotSatisfiableError
		if errors.As(err, &rangeErr) && rangeErr.ContentRange != "" {
			h.Set("Content-Range", rangeErr.ContentRange)
		}
		return echo.NewHTTPError(http.StatusRequestedRangeNotSatisfiable, "requested range not satisfiable")
	}
	return echo.NewHTTPError(http.StatusInternalServerError, "failed to stream from S3").Wrap(err)
}

func sendObjectStream(c *echo.Context, object *storage.ObjectStream, contentType string) error {
	defer object.Body.Close()

	h := c.Response().Header()
	h.Set("Accept-Ranges", "bytes")
	if object.ContentLength >= 0 {
		h.Set(echo.HeaderContentLength, strconv.FormatInt(object.ContentLength, 10))
	}
	status := http.StatusOK
	if object.ContentRange != "" {
		h.Set("Content-Range", object.ContentRange)
		status = http.StatusPartialContent
	}
	return c.Stream(status, contentType, object.Body)
}

// singleRangeHeader returns a Range value only when it contains one range.
// Ignoring unsupported Range requests is permitted by HTTP and lets the caller
// send the complete representation instead of relaying a request S3 rejects.
func singleRangeHeader(header http.Header) string {
	values := header.Values("Range")
	if len(values) != 1 || strings.Contains(values[0], ",") {
		return ""
	}
	unit, ranges, ok := strings.Cut(values[0], "=")
	if !ok || !strings.EqualFold(strings.TrimSpace(unit), "bytes") || strings.TrimSpace(ranges) == "" {
		return ""
	}
	return values[0]
}

// =============================================================================
// Attachment Permissions
// =============================================================================

// checkOriginalPermission applies the still photo's release to its paired camera video.
func (s *FileServerService) checkOriginalPermission(ctx context.Context, c *echo.Context, a *store.Attachment) error {
	if c.QueryParam("share_token") == "" {
		viewer, err := s.getCurrentUser(ctx, c)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to resolve photo viewer").Wrap(err)
		}
		if viewer != nil && viewer.ID == a.CreatorID {
			return nil
		}
	}
	motion := a.Payload.GetMotionMedia()
	if motion.GetRole() != storepb.MotionMediaRole_VIDEO {
		if a.Payload.GetAllowOriginal() {
			return nil
		}
	} else if a.MemoID != nil && motion.GetGroupId() != "" {
		attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: a.MemoID, CreatorID: &a.CreatorID, SkipDefaultLimit: true})
		if err != nil {
			return err
		}
		for _, still := range attachments {
			pair := still.Payload.GetMotionMedia()
			if pair.GetFamily() == storepb.MotionMediaFamily_APPLE_LIVE_PHOTO && pair.GetRole() == storepb.MotionMediaRole_STILL && pair.GetGroupId() == motion.GetGroupId() && still.Payload.GetAllowOriginal() {
				return nil
			}
		}
	}
	return echo.NewHTTPError(http.StatusForbidden, "original is private")
}

// checkAttachmentPermission verifies the user has permission to access the attachment.
func (s *FileServerService) checkAttachmentPermission(ctx context.Context, c *echo.Context, attachment *store.Attachment) (access.MemoReadClass, error) {
	// For unlinked attachments, only the creator can access.
	if attachment.MemoID == nil {
		user, err := s.getCurrentUser(ctx, c)
		if err != nil {
			return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusInternalServerError, "failed to get current user").Wrap(err)
		}
		if user == nil {
			return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusUnauthorized, "unauthorized access")
		}
		if user.ID != attachment.CreatorID && user.Role != store.RoleAdmin {
			return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusForbidden, "forbidden access")
		}
		return access.MemoReadClassPrivate, nil
	}

	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: attachment.MemoID})
	if err != nil {
		return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusInternalServerError, "failed to find memo").Wrap(err)
	}
	if memo == nil {
		return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusNotFound, "memo not found")
	}

	var parent *store.Memo
	if memo.ParentUID != nil {
		parent, err = s.Store.GetMemo(ctx, &store.FindMemo{UID: memo.ParentUID})
		if err != nil {
			return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusInternalServerError, "failed to find parent memo").Wrap(err)
		}
		if parent == nil {
			return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusNotFound, "memo not found")
		}
	}

	allowAnonymous := s.Profile != nil && s.Profile.AllowAnonymous()
	if decision := access.CheckMemoRead(memo, parent, nil, allowAnonymous, nil); decision.Allowed() {
		return decision.Class, nil
	}

	var sharedMemoID *int32
	if shareToken := (*c).QueryParam("share_token"); shareToken != "" {
		ms, err := s.Store.GetMemoShare(ctx, &store.FindMemoShare{UID: &shareToken})
		if err != nil {
			return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusInternalServerError, "failed to get memo share").Wrap(err)
		}
		if ms != nil && !isMemoShareExpired(ms) {
			sharedMemoID = &ms.MemoID
			if decision := access.CheckMemoRead(memo, parent, nil, allowAnonymous, sharedMemoID); decision.Allowed() {
				return decision.Class, nil
			}
		}
	}

	user, err := s.getCurrentUser(ctx, c)
	if err != nil {
		return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusInternalServerError, "failed to get current user").Wrap(err)
	}
	decision := access.CheckMemoRead(memo, parent, user, allowAnonymous, sharedMemoID)
	switch decision.Denial {
	case access.MemoReadDenialNone:
		return decision.Class, nil
	case access.MemoReadDenialNotFound:
		return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusNotFound, "memo not found")
	case access.MemoReadDenialUnauthenticated:
		return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusUnauthorized, "unauthorized access")
	default:
		return access.MemoReadClassPrivate, echo.NewHTTPError(http.StatusForbidden, "forbidden access")
	}
}

// getCurrentUser retrieves the current authenticated user from the request.
// Authentication priority: Bearer token (Access Token V2 or PAT) > Refresh token cookie.
func (s *FileServerService) getCurrentUser(ctx context.Context, c *echo.Context) (*store.User, error) {
	authHeader := c.Request().Header.Get(echo.HeaderAuthorization)
	cookieHeader := c.Request().Header.Get("Cookie")
	return s.authenticator.AuthenticateToUser(ctx, authHeader, cookieHeader)
}

// =============================================================================
// Helper Functions
// =============================================================================

// sanitizeContentType converts potentially dangerous MIME types to safe alternatives.
func sanitizeContentType(mimeType string) string {
	contentType := mimeType
	if strings.HasPrefix(contentType, "text/") {
		contentType += "; charset=utf-8"
	}
	// Normalize for case-insensitive lookup.
	if xssUnsafeTypes[strings.ToLower(mimeType)] {
		return "application/octet-stream"
	}
	return contentType
}

// parseDataURI extracts MIME type and decoded data from a data URI.
func parseDataURI(dataURI string) (string, []byte, error) {
	matches := dataURIRegex.FindStringSubmatch(dataURI)
	if len(matches) != 3 {
		return "", nil, errors.New("invalid data URI format")
	}

	imageType := matches[1]
	imageData, err := base64.StdEncoding.DecodeString(matches[2])
	if err != nil {
		return "", nil, errors.Wrap(err, "failed to decode base64 data")
	}

	return imageType, imageData, nil
}

// isMediaType checks if the MIME type is video or audio.
func isMediaType(mimeType string) bool {
	return strings.HasPrefix(mimeType, "video/") || strings.HasPrefix(mimeType, "audio/")
}

// setSecurityHeaders sets common security headers for all responses.
func setSecurityHeaders(c *echo.Context) {
	h := c.Response().Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "DENY")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline';")
}

// setMediaHeaders sets headers for media file responses.
func setMediaHeaders(c *echo.Context, contentType, originalType string) {
	h := c.Response().Header()
	h.Set(echo.HeaderContentType, contentType)
	if h.Get(echo.HeaderCacheControl) == "" {
		h.Set(echo.HeaderCacheControl, cacheMaxAge)
	}

	// Support HDR/wide color gamut for images and videos.
	if strings.HasPrefix(originalType, "image/") || strings.HasPrefix(originalType, "video/") {
		h.Set("Color-Gamut", "srgb, p3, rec2020")
	}
}

// isMemoShareExpired returns true if the share has a defined expiry that has already passed.
func isMemoShareExpired(ms *store.MemoShare) bool {
	return ms.ExpiresTs != nil && time.Now().Unix() > *ms.ExpiresTs
}
