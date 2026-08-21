package v1

import (
	"context"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

func (s *APIV1Service) ListMemoReactions(ctx context.Context, request *v1pb.ListMemoReactionsRequest) (*v1pb.ListMemoReactionsResponse, error) {
	// Extract memo UID and check visibility.
	memoUID, err := ExtractMemoUIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}

	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if user == nil {
		if err := s.checkMemoAndParentReadAccess(ctx, memo); err != nil {
			return nil, err
		}
	} else if memo.Visibility == store.Private && memo.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	reactions, err := s.Store.ListReactions(ctx, &store.FindReaction{
		ContentID: &request.Name,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list reactions")
	}

	response := &v1pb.ListMemoReactionsResponse{
		Reactions: []*v1pb.Reaction{},
	}
	response.Reactions, err = s.convertReactionsFromStoreWithCreators(ctx, reactions, nil)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to convert reactions")
	}
	return response, nil
}

func (s *APIV1Service) UpsertMemoReaction(ctx context.Context, request *v1pb.UpsertMemoReactionRequest) (*v1pb.Reaction, error) {
	if request.Reaction == nil {
		return nil, status.Errorf(codes.InvalidArgument, "reaction is required")
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}
	visitorID := visitorIDFromContext(ctx)
	if user == nil && visitorID == "" {
		return nil, status.Errorf(codes.Unauthenticated, "visitor identity is required")
	}

	// Extract memo UID and check visibility before allowing reaction.
	memoUID, err := ExtractMemoUIDFromName(request.Reaction.ContentId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}

	if user == nil {
		if err := s.checkMemoAndParentReadAccess(ctx, memo); err != nil {
			return nil, err
		}
	} else if memo.Visibility == store.Private && memo.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	creatorID := int32(0)
	if user != nil {
		creatorID = user.ID
		visitorID = ""
	}
	reaction, err := s.Store.UpsertReaction(ctx, &store.Reaction{
		CreatorID:    creatorID,
		VisitorID:    visitorID,
		ContentID:    request.Reaction.ContentId,
		ReactionType: request.Reaction.ReactionType,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to upsert reaction")
	}

	reactionMessage, err := s.convertReactionFromStore(ctx, reaction)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to convert reaction")
	}

	// Broadcast live refresh event (reaction belongs to a memo).
	var parentMemo *store.Memo
	if memo.ParentUID != nil {
		parentMemo, _ = s.Store.GetMemo(ctx, &store.FindMemo{UID: memo.ParentUID})
	}
	s.SSEHub.Broadcast(buildMemoReactionSSEEvent(SSEEventReactionUpserted, request.Reaction.ContentId, memo, parentMemo))

	return reactionMessage, nil
}

func (s *APIV1Service) DeleteMemoReaction(ctx context.Context, request *v1pb.DeleteMemoReactionRequest) (*emptypb.Empty, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	visitorID := visitorIDFromContext(ctx)
	if user == nil && visitorID == "" {
		return nil, status.Errorf(codes.Unauthenticated, "visitor identity is required")
	}

	_, reactionID, err := ExtractMemoReactionIDFromName(request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid reaction name: %v", err)
	}

	// Get reaction and check ownership.
	reaction, err := s.Store.GetReaction(ctx, &store.FindReaction{
		ID: &reactionID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get reaction")
	}
	if reaction == nil {
		// Return permission denied to avoid revealing if reaction exists.
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	if user == nil {
		if reaction.VisitorID == "" || reaction.VisitorID != visitorID {
			return nil, status.Errorf(codes.PermissionDenied, "permission denied")
		}
	} else if reaction.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}

	if err := s.Store.DeleteReaction(ctx, &store.DeleteReaction{
		ID: reactionID,
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete reaction")
	}

	memoUID, err := ExtractMemoUIDFromName(reaction.ContentID)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo")
	}

	// Broadcast live refresh event (reaction belongs to a memo).
	var parentMemo *store.Memo
	if memo != nil && memo.ParentUID != nil {
		parentMemo, _ = s.Store.GetMemo(ctx, &store.FindMemo{UID: memo.ParentUID})
	}
	s.SSEHub.Broadcast(buildMemoReactionSSEEvent(SSEEventReactionDeleted, reaction.ContentID, memo, parentMemo))

	return &emptypb.Empty{}, nil
}

func (s *APIV1Service) convertReactionFromStore(ctx context.Context, reaction *store.Reaction) (*v1pb.Reaction, error) {
	creatorIDs := []int32{}
	if reaction.CreatorID != 0 {
		creatorIDs = append(creatorIDs, reaction.CreatorID)
	}
	creatorsByID, err := s.listUsersByIDWithExisting(ctx, creatorIDs, nil)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get reaction creator")
	}
	reactionMessage, err := convertReactionFromStoreWithCreators(ctx, reaction, creatorsByID)
	if err != nil {
		slog.Warn("Failed to convert reaction with missing creator",
			slog.Int64("reaction_id", int64(reaction.ID)),
			slog.Int64("creator_id", int64(reaction.CreatorID)),
			slog.String("content_id", reaction.ContentID),
		)
		return nil, status.Errorf(codes.NotFound, "reaction creator not found")
	}
	return reactionMessage, nil
}
