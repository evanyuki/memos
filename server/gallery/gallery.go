// Package gallery projects existing memo attachments into a read-only photo gallery.
package gallery

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
)

// Photo retains the existing API types and their memo-level permissions.
type Photo struct {
	Attachment *v1pb.Attachment
	Memo       *v1pb.Memo
}

// MarshalJSON preserves protobuf JSON enums, timestamps, and media metadata.
func (p Photo) MarshalJSON() ([]byte, error) {
	attachment, err := protojson.Marshal(p.Attachment)
	if err != nil {
		return nil, err
	}
	memo, err := protojson.Marshal(p.Memo)
	if err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		Attachment json.RawMessage `json:"attachment"`
		Memo       json.RawMessage `json:"memo"`
	}{attachment, memo})
}

// Page uses MemoService's cursor. A page contains photos from up to 20 memos.
type Page struct {
	Photos        []Photo `json:"photos"`
	NextPageToken string  `json:"nextPageToken"`
}

// Query specifies gallery display filters; none can broaden memo read access.
type Query struct {
	Visibility string
	Tag        string
	State      string
	PageToken  string
}

// Service reuses the existing memo and attachment services in process.
type Service struct {
	API *apiv1.APIV1Service
}

// List returns images of readable, non-comment memos, using existing pagination.
func (s *Service) List(ctx context.Context, query Query) (*Page, error) {
	filters := []string{}
	switch query.Visibility {
	case "", "ALL":
	case "PUBLIC", "PROTECTED", "PRIVATE":
		filters = append(filters, "visibility == "+strconv.Quote(query.Visibility))
	default:
		return nil, status.Error(codes.InvalidArgument, "invalid gallery visibility")
	}
	if len(query.Tag) > 256 || len(query.PageToken) > 2048 {
		return nil, status.Error(codes.InvalidArgument, "gallery query is too long")
	}
	if query.Tag != "" {
		filters = append(filters, strconv.Quote(query.Tag)+" in tags")
	}
	state := v1pb.State_NORMAL
	if query.State == "ARCHIVED" {
		state = v1pb.State_ARCHIVED
	} else if query.State != "" && query.State != "NORMAL" {
		return nil, status.Error(codes.InvalidArgument, "invalid gallery state")
	}
	memos, err := s.API.ListMemos(ctx, &v1pb.ListMemosRequest{
		PageSize: 20, PageToken: query.PageToken, State: state, Filter: strings.Join(filters, " && "),
	})
	if err != nil {
		return nil, err
	}
	page := &Page{Photos: []Photo{}, NextPageToken: memos.NextPageToken}
	for _, memo := range memos.Memos {
		for _, attachment := range memo.Attachments {
			if isGalleryPhoto(attachment) {
				page.Photos = append(page.Photos, Photo{Attachment: attachment, Memo: memo})
			}
		}
	}
	return page, nil
}

// Get returns one photo after resolving its parent memo under the existing policy.
// A share token grants this memo's attachments only, never other photos or comments.
func (s *Service) Get(ctx context.Context, uid, shareToken string) (*Photo, error) {
	if _, err := apiv1.ExtractAttachmentUIDFromName("attachments/" + uid); err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid photo ID")
	}
	var memo *v1pb.Memo
	var err error
	if shareToken != "" {
		if len(shareToken) > 128 {
			return nil, status.Error(codes.NotFound, "photo not found")
		}
		memo, err = s.API.GetSharedMemo(ctx, &v1pb.GetSharedMemoRequest{ShareToken: shareToken})
	} else {
		var attachment *v1pb.Attachment
		attachment, err = s.API.GetAttachment(ctx, &v1pb.GetAttachmentRequest{Name: "attachments/" + uid})
		if err == nil {
			if attachment.GetMemo() == "" {
				return nil, status.Error(codes.NotFound, "photo not found")
			}
			memo, err = s.API.GetMemo(ctx, &v1pb.GetMemoRequest{Name: attachment.GetMemo()})
		}
	}
	if err != nil {
		return nil, err
	}
	if memo.GetParent() != "" {
		return nil, status.Error(codes.NotFound, "photo not found")
	}
	for _, attachment := range memo.Attachments {
		if attachment.Name == "attachments/"+uid && isGalleryPhoto(attachment) {
			return &Photo{Attachment: attachment, Memo: memo}, nil
		}
	}
	return nil, status.Error(codes.NotFound, "photo not found")
}

func isGalleryPhoto(attachment *v1pb.Attachment) bool {
	// External URLs cannot inherit memo permissions. Only managed uploads belong
	// in this gallery; their bytes always pass through the authorized file route.
	return strings.HasPrefix(attachment.Type, "image/") && attachment.ExternalLink == ""
}
