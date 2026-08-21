package v1

import (
	"context"
	"regexp"
	"strings"

	"google.golang.org/grpc/metadata"
)

const (
	visitorIDHeader      = "X-Memos-Visitor-ID"
	visitorIDMetadataKey = "x-memos-visitor-id"
)

var visitorIDPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func visitorIDFromContext(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get(visitorIDMetadataKey)
	if len(values) != 1 || !visitorIDPattern.MatchString(values[0]) {
		return ""
	}
	return strings.ToLower(values[0])
}
