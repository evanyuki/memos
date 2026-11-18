package fileserver

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"

	"github.com/usememos/memos/internal/photomedia"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// StartPhotoWorker drains pending attachments, newest first. The attachment record is the
// durable work item: instance restarts lose neither the uploaded file nor its pending state.
func (s *FileServerService) StartPhotoWorker(ctx context.Context, index photoIndexer) func() {
	wake := make(chan struct{}, 1)
	notify := func() {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-wake:
			}
			const limit = 2
			n, err := s.processPhotoBatch(ctx, index, limit)
			if err != nil && ctx.Err() == nil {
				slog.Warn("list pending photos", "error", err)
			}
			if err == nil && n == limit {
				notify()
			}
		}
	}()
	notify()
	return notify
}

type photoIndexer func(context.Context, *store.Attachment, []byte) error

// RegisterPhotoMaintenance lets a scheduled invocation finish work while the Vercel
// instance is active. Readers can always generate a missing derivative on demand.
func (s *FileServerService) RegisterPhotoMaintenance(e *echo.Echo, index photoIndexer, secret string) {
	if secret == "" {
		return
	}
	e.GET("/internal/photos/prepare", func(c *echo.Context) error {
		if subtle.ConstantTimeCompare([]byte(c.Request().Header.Get("Authorization")), []byte("Bearer "+secret)) != 1 {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized maintenance request")
		}
		ctx, cancel := context.WithTimeout(c.Request().Context(), 45*time.Second)
		defer cancel()
		for ctx.Err() == nil {
			n, err := s.processPhotoBatch(ctx, index, 2)
			if err != nil && ctx.Err() == nil {
				return err
			}
			if n == 0 {
				break
			}
		}
		c.Response().Header().Set("Cache-Control", "no-store")
		return c.NoContent(http.StatusNoContent)
	})
}

func (s *FileServerService) processPhotoBatch(ctx context.Context, index photoIndexer, limit int) (int, error) {
	now := time.Now().Unix()
	photos, err := s.Store.ListAttachments(ctx, &store.FindAttachment{PendingPhotosAt: &now, Limit: &limit})
	if err != nil {
		return 0, err
	}
	for _, a := range photos {
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		retry := time.Now().Add(15 * time.Minute).Unix()
		if err := s.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: a.ID, PayloadPatch: map[string]any{"photoRetryAfter": retry}}); err != nil {
			return 0, err
		}
		if err := s.preparePhoto(ctx, a, index); err != nil && ctx.Err() == nil {
			slog.Warn("prepare photo", "attachment", a.UID, "error", err)
		}
	}
	return len(photos), nil
}

func (s *FileServerService) preparePhoto(ctx context.Context, a *store.Attachment, index photoIndexer) error {
	if !photomedia.SupportsImage(a.Type) || a.StorageType == storepb.AttachmentStorageType_EXTERNAL {
		return s.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: a.ID, PayloadPatch: map[string]any{"photoPreviewVersion": 1, "locationStatus": photomedia.Unknown, "photoRetryAfter": 0}})
	}
	original, err := s.getAttachmentBlob(ctx, a)
	if err != nil {
		return err
	}
	if err := index(ctx, a, original); err != nil {
		return err
	}
	_, displayErr := s.photoBytes(ctx, a, photomedia.Display, original)
	_, thumbnailErr := s.photoBytes(ctx, a, photomedia.Thumbnail, original)
	if canUseDisplayThumbnail(a, thumbnailErr) {
		thumbnailErr = nil
	}
	if err := errors.Join(thumbnailErr, displayErr); err != nil {
		return err
	}
	return s.Store.UpdateAttachment(ctx, &store.UpdateAttachment{ID: a.ID, PayloadPatch: map[string]any{"photoPreviewVersion": 1, "photoRetryAfter": 0}})
}
