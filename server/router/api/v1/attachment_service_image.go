package v1

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/motionphoto"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func validateClientMotionMedia(motion *v1pb.MotionMedia) (*storepb.MotionMedia, error) {
	if motion == nil {
		return nil, nil
	}

	if motion.Family != v1pb.MotionMediaFamily_APPLE_LIVE_PHOTO {
		return nil, status.Errorf(codes.InvalidArgument, "only Apple Live Photo motion metadata can be provided by clients")
	}
	if motion.Role != v1pb.MotionMediaRole_STILL && motion.Role != v1pb.MotionMediaRole_VIDEO {
		return nil, status.Errorf(codes.InvalidArgument, "invalid Apple Live Photo motion role")
	}

	storeMotion := convertMotionMediaToStore(motion)
	if storeMotion.GroupId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "motion media group_id is required")
	}

	return storeMotion, nil
}

func detectAndroidMotionMedia(blob []byte, mimeType, attachmentUID string) *storepb.MotionMedia {
	if mimeType != "image/jpeg" && mimeType != "image/jpg" {
		return nil
	}

	detection := motionphoto.DetectJPEG(blob)
	if detection == nil {
		return nil
	}

	return &storepb.MotionMedia{
		Family:                  storepb.MotionMediaFamily_ANDROID_MOTION_PHOTO,
		Role:                    storepb.MotionMediaRole_CONTAINER,
		GroupId:                 attachmentUID,
		PresentationTimestampUs: detection.PresentationTimestampUs,
		HasEmbeddedVideo:        true,
	}
}
