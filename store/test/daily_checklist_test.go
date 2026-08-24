package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestDailyChecklistUpsertGetAndDelete(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	defer ts.Close()

	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	created, err := ts.UpsertDailyChecklist(ctx, &store.DailyChecklist{
		CreatorID:  user.ID,
		Date:       "2026-08-24",
		CreatedTs:  100,
		Visibility: store.DailyChecklistPrivate,
		Payload: &storepb.DailyChecklistPayload{
			TaskSection: &storepb.DailyChecklistPayload_TaskSection{
				FirstTask: "Write the plan",
				MustWinTasks: []*storepb.DailyChecklistPayload_Task{
					{Id: "task-1", Content: "Ship the checklist", Completed: false},
				},
			},
		},
	})
	require.NoError(t, err)
	require.NotZero(t, created.ID)
	require.Equal(t, int64(100), created.CreatedTs)

	got, err := ts.GetDailyChecklist(ctx, &store.FindDailyChecklist{CreatorID: user.ID, Date: "2026-08-24"})
	require.NoError(t, err)
	require.Equal(t, created.ID, got.ID)
	require.Equal(t, store.DailyChecklistPrivate, got.Visibility)
	require.Equal(t, "Write the plan", got.Payload.GetTaskSection().GetFirstTask())
	require.Equal(t, "Ship the checklist", got.Payload.GetTaskSection().GetMustWinTasks()[0].GetContent())

	updated, err := ts.UpsertDailyChecklist(ctx, &store.DailyChecklist{
		CreatorID:  user.ID,
		Date:       "2026-08-24",
		Visibility: store.DailyChecklistPublic,
		Payload: &storepb.DailyChecklistPayload{
			EveningReflection: &storepb.DailyChecklistPayload_EveningReflection{MostEffectiveAction: "Protected focus time"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, created.ID, updated.ID)
	require.Equal(t, int64(100), updated.CreatedTs)
	require.Equal(t, store.DailyChecklistPublic, updated.Visibility)
	require.Equal(t, "Protected focus time", updated.Payload.GetEveningReflection().GetMostEffectiveAction())

	require.NoError(t, ts.DeleteDailyChecklist(ctx, &store.DeleteDailyChecklist{CreatorID: user.ID, Date: "2026-08-24"}))
	got, err = ts.GetDailyChecklist(ctx, &store.FindDailyChecklist{CreatorID: user.ID, Date: "2026-08-24"})
	require.NoError(t, err)
	require.Nil(t, got)
}
