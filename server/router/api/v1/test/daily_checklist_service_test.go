package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

func TestDailyChecklistVisibilityAndOwnership(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "checklist-owner")
	require.NoError(t, err)
	peer, err := ts.CreateRegularUser(ctx, "checklist-peer")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	peerCtx := ts.CreateUserContext(ctx, peer.ID)
	name := "users/checklist-owner/dailyChecklists/2026-08-24"

	privateChecklist, err := ts.Service.UpsertDailyChecklist(ownerCtx, &v1pb.UpsertDailyChecklistRequest{
		DailyChecklist: &v1pb.DailyChecklist{
			Name:       name,
			Date:       "2026-08-24",
			Visibility: v1pb.Visibility_PRIVATE,
			TaskSection: &v1pb.DailyChecklistTaskSection{
				FirstTask: "Write the plan",
				MustWinTasks: []*v1pb.DailyChecklistTask{
					{Id: "task-1", Content: "Ship the checklist", Completed: true},
				},
			},
			EveningReflection: &v1pb.DailyChecklistEveningReflection{MostEffectiveAction: "Protected focus time"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, name, privateChecklist.Name)
	require.Equal(t, "users/checklist-owner", privateChecklist.Creator)
	require.NotNil(t, privateChecklist.CreateTime)
	require.NotNil(t, privateChecklist.UpdateTime)

	got, err := ts.Service.GetDailyChecklist(ownerCtx, &v1pb.GetDailyChecklistRequest{Name: name})
	require.NoError(t, err)
	require.Equal(t, "Ship the checklist", got.TaskSection.MustWinTasks[0].Content)
	require.Equal(t, "Protected focus time", got.EveningReflection.MostEffectiveAction)

	_, err = ts.Service.GetDailyChecklist(ctx, &v1pb.GetDailyChecklistRequest{Name: name})
	require.Equal(t, codes.NotFound, status.Code(err))
	_, err = ts.Service.GetDailyChecklist(peerCtx, &v1pb.GetDailyChecklistRequest{Name: name})
	require.Equal(t, codes.NotFound, status.Code(err))

	privateChecklist.Visibility = v1pb.Visibility_PUBLIC
	publicChecklist, err := ts.Service.UpsertDailyChecklist(ownerCtx, &v1pb.UpsertDailyChecklistRequest{DailyChecklist: privateChecklist})
	require.NoError(t, err)
	require.Equal(t, v1pb.Visibility_PUBLIC, publicChecklist.Visibility)

	got, err = ts.Service.GetDailyChecklist(ctx, &v1pb.GetDailyChecklistRequest{Name: name})
	require.NoError(t, err)
	require.Equal(t, name, got.Name)

	_, err = ts.Service.UpsertDailyChecklist(peerCtx, &v1pb.UpsertDailyChecklistRequest{DailyChecklist: privateChecklist})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
	_, err = ts.Service.DeleteDailyChecklist(peerCtx, &v1pb.DeleteDailyChecklistRequest{Name: name})
	require.Equal(t, codes.PermissionDenied, status.Code(err))

	_, err = ts.Service.DeleteDailyChecklist(ownerCtx, &v1pb.DeleteDailyChecklistRequest{Name: name})
	require.NoError(t, err)
	_, err = ts.Service.GetDailyChecklist(ownerCtx, &v1pb.GetDailyChecklistRequest{Name: name})
	require.Equal(t, codes.NotFound, status.Code(err))
}

func TestDailyChecklistValidation(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "checklist-validation")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	tests := []struct {
		name      string
		checklist *v1pb.DailyChecklist
	}{
		{
			name: "date does not match name",
			checklist: &v1pb.DailyChecklist{
				Name: "users/checklist-validation/dailyChecklists/2026-08-24",
				Date: "2026-08-25",
			},
		},
		{
			name: "invalid calendar date",
			checklist: &v1pb.DailyChecklist{
				Name: "users/checklist-validation/dailyChecklists/2026-02-30",
				Date: "2026-02-30",
			},
		},
		{
			name: "blank task content",
			checklist: &v1pb.DailyChecklist{
				Name: "users/checklist-validation/dailyChecklists/2026-08-24",
				Date: "2026-08-24",
				TaskSection: &v1pb.DailyChecklistTaskSection{
					MustWinTasks: []*v1pb.DailyChecklistTask{{Id: "task-1", Content: "  "}},
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ts.Service.UpsertDailyChecklist(ownerCtx, &v1pb.UpsertDailyChecklistRequest{DailyChecklist: test.checklist})
			require.Equal(t, codes.InvalidArgument, status.Code(err))
		})
	}
}
