package v1

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	dailyChecklistCollection = "dailyChecklists"
	maxDailyChecklistTasks   = 50
)

func parseDailyChecklistName(name string) (string, string, error) {
	parts := strings.Split(name, "/")
	if len(parts) != 4 || parts[0] != "users" || parts[1] == "" || parts[2] != dailyChecklistCollection {
		return "", "", errors.Errorf("invalid daily checklist name %q", name)
	}
	date, err := normalizeDailyChecklistDate(parts[3])
	if err != nil {
		return "", "", err
	}
	return parts[1], date, nil
}

func normalizeDailyChecklistDate(value string) (string, error) {
	date, err := time.Parse(time.DateOnly, value)
	if err != nil || date.Format(time.DateOnly) != value {
		return "", errors.Errorf("invalid daily checklist date %q; expected YYYY-MM-DD", value)
	}
	return value, nil
}

func dailyChecklistName(username, date string) string {
	return BuildUserName(username) + "/" + dailyChecklistCollection + "/" + date
}

func validateDailyChecklistText(field, value string, maxLength int) error {
	if utf8.RuneCountInString(value) > maxLength {
		return errors.Errorf("%s exceeds %d characters", field, maxLength)
	}
	return nil
}

func validateDailyChecklist(checklist *v1pb.DailyChecklist) error {
	if checklist == nil {
		return errors.New("daily checklist is required")
	}

	taskSection := checklist.GetTaskSection()
	for _, field := range []struct {
		name  string
		value string
		max   int
	}{
		{name: "first_task", value: taskSection.GetFirstTask(), max: 500},
		{name: "if_then", value: taskSection.GetIfThen(), max: 1000},
		{name: "notes", value: taskSection.GetNotes(), max: 5000},
	} {
		if err := validateDailyChecklistText(field.name, field.value, field.max); err != nil {
			return err
		}
	}

	tasks := taskSection.GetMustWinTasks()
	if len(tasks) > maxDailyChecklistTasks {
		return errors.Errorf("must_win_tasks exceeds %d items", maxDailyChecklistTasks)
	}
	seenTaskIDs := make(map[string]struct{}, len(tasks))
	for i, task := range tasks {
		if task == nil || strings.TrimSpace(task.GetId()) == "" {
			return errors.Errorf("must_win_tasks[%d].id is required", i)
		}
		if utf8.RuneCountInString(task.GetId()) > 64 {
			return errors.Errorf("must_win_tasks[%d].id exceeds 64 characters", i)
		}
		if _, exists := seenTaskIDs[task.GetId()]; exists {
			return errors.Errorf("duplicate task id %q", task.GetId())
		}
		seenTaskIDs[task.GetId()] = struct{}{}
		if strings.TrimSpace(task.GetContent()) == "" {
			return errors.Errorf("must_win_tasks[%d].content is required", i)
		}
		if err := validateDailyChecklistText("task content", task.GetContent(), 500); err != nil {
			return err
		}
	}

	reflection := checklist.GetEveningReflection()
	for _, field := range []struct {
		name  string
		value string
	}{
		{name: "most_effective_action", value: reflection.GetMostEffectiveAction()},
		{name: "biggest_obstacle", value: reflection.GetBiggestObstacle()},
		{name: "obstacle_response", value: reflection.GetObstacleResponse()},
		{name: "keep_for_tomorrow", value: reflection.GetKeepForTomorrow()},
		{name: "remove_for_tomorrow", value: reflection.GetRemoveForTomorrow()},
		{name: "first_task_tomorrow", value: reflection.GetFirstTaskTomorrow()},
	} {
		if err := validateDailyChecklistText(field.name, field.value, 2000); err != nil {
			return err
		}
	}

	if checklist.GetVisibility() != v1pb.Visibility_PRIVATE &&
		checklist.GetVisibility() != v1pb.Visibility_PUBLIC &&
		checklist.GetVisibility() != v1pb.Visibility_VISIBILITY_UNSPECIFIED {
		return errors.New("visibility must be PRIVATE or PUBLIC")
	}
	return nil
}

func convertDailyChecklistPayloadToStore(checklist *v1pb.DailyChecklist) *storepb.DailyChecklistPayload {
	taskSection := checklist.GetTaskSection()
	storeTasks := make([]*storepb.DailyChecklistPayload_Task, 0, len(taskSection.GetMustWinTasks()))
	for _, task := range taskSection.GetMustWinTasks() {
		storeTasks = append(storeTasks, &storepb.DailyChecklistPayload_Task{
			Id:        task.GetId(),
			Content:   task.GetContent(),
			Completed: task.GetCompleted(),
		})
	}
	reflection := checklist.GetEveningReflection()
	return &storepb.DailyChecklistPayload{
		TaskSection: &storepb.DailyChecklistPayload_TaskSection{
			FirstTask:    taskSection.GetFirstTask(),
			IfThen:       taskSection.GetIfThen(),
			MustWinTasks: storeTasks,
			Notes:        taskSection.GetNotes(),
		},
		EveningReflection: &storepb.DailyChecklistPayload_EveningReflection{
			MostEffectiveAction: reflection.GetMostEffectiveAction(),
			BiggestObstacle:     reflection.GetBiggestObstacle(),
			ObstacleResponse:    reflection.GetObstacleResponse(),
			KeepForTomorrow:     reflection.GetKeepForTomorrow(),
			RemoveForTomorrow:   reflection.GetRemoveForTomorrow(),
			FirstTaskTomorrow:   reflection.GetFirstTaskTomorrow(),
		},
	}
}

func convertDailyChecklistFromStore(username string, checklist *store.DailyChecklist) *v1pb.DailyChecklist {
	payload := checklist.Payload
	if payload == nil {
		payload = &storepb.DailyChecklistPayload{}
	}
	taskSection := payload.GetTaskSection()
	tasks := make([]*v1pb.DailyChecklistTask, 0, len(taskSection.GetMustWinTasks()))
	for _, task := range taskSection.GetMustWinTasks() {
		tasks = append(tasks, &v1pb.DailyChecklistTask{
			Id:        task.GetId(),
			Content:   task.GetContent(),
			Completed: task.GetCompleted(),
		})
	}
	reflection := payload.GetEveningReflection()
	visibility := v1pb.Visibility_PRIVATE
	if checklist.Visibility == store.DailyChecklistPublic {
		visibility = v1pb.Visibility_PUBLIC
	}
	return &v1pb.DailyChecklist{
		Name:       dailyChecklistName(username, checklist.Date),
		Creator:    BuildUserName(username),
		Date:       checklist.Date,
		CreateTime: timestamppb.New(time.Unix(checklist.CreatedTs, 0)),
		UpdateTime: timestamppb.New(time.Unix(checklist.UpdatedTs, 0)),
		Visibility: visibility,
		TaskSection: &v1pb.DailyChecklistTaskSection{
			FirstTask:    taskSection.GetFirstTask(),
			IfThen:       taskSection.GetIfThen(),
			MustWinTasks: tasks,
			Notes:        taskSection.GetNotes(),
		},
		EveningReflection: &v1pb.DailyChecklistEveningReflection{
			MostEffectiveAction: reflection.GetMostEffectiveAction(),
			BiggestObstacle:     reflection.GetBiggestObstacle(),
			ObstacleResponse:    reflection.GetObstacleResponse(),
			KeepForTomorrow:     reflection.GetKeepForTomorrow(),
			RemoveForTomorrow:   reflection.GetRemoveForTomorrow(),
			FirstTaskTomorrow:   reflection.GetFirstTaskTomorrow(),
		},
	}
}

func (s *APIV1Service) resolveDailyChecklistOwner(ctx context.Context, name string) (*store.User, string, error) {
	username, date, err := parseDailyChecklistName(name)
	if err != nil {
		return nil, "", status.Errorf(codes.InvalidArgument, "invalid daily checklist name: %v", err)
	}
	owner, err := ResolveUserByName(ctx, s.Store, BuildUserName(username))
	if err != nil {
		return nil, "", status.Errorf(codes.Internal, "failed to resolve checklist owner: %v", err)
	}
	if owner == nil {
		return nil, "", status.Errorf(codes.NotFound, "user not found")
	}
	return owner, date, nil
}

// GetDailyChecklist returns an owner's checklist when the caller may read it.
func (s *APIV1Service) GetDailyChecklist(ctx context.Context, request *v1pb.GetDailyChecklistRequest) (*v1pb.DailyChecklist, error) {
	owner, date, err := s.resolveDailyChecklistOwner(ctx, request.GetName())
	if err != nil {
		return nil, err
	}
	checklist, err := s.Store.GetDailyChecklist(ctx, &store.FindDailyChecklist{CreatorID: owner.ID, Date: date})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get daily checklist: %v", err)
	}
	if checklist == nil {
		return nil, status.Errorf(codes.NotFound, "daily checklist not found")
	}

	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if checklist.Visibility != store.DailyChecklistPublic && (currentUser == nil || currentUser.ID != owner.ID) {
		// Hide private checklist existence from callers other than the owner.
		return nil, status.Errorf(codes.NotFound, "daily checklist not found")
	}
	return convertDailyChecklistFromStore(owner.Username, checklist), nil
}

// UpsertDailyChecklist creates or replaces one owned daily checklist.
func (s *APIV1Service) UpsertDailyChecklist(ctx context.Context, request *v1pb.UpsertDailyChecklistRequest) (*v1pb.DailyChecklist, error) {
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if err := validateDailyChecklist(request.GetDailyChecklist()); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid daily checklist: %v", err)
	}

	owner, date, err := s.resolveDailyChecklistOwner(ctx, request.GetDailyChecklist().GetName())
	if err != nil {
		return nil, err
	}
	if owner.ID != currentUser.ID {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	if inputDate := request.GetDailyChecklist().GetDate(); inputDate != "" && inputDate != date {
		return nil, status.Errorf(codes.InvalidArgument, "daily checklist date does not match its name")
	}

	visibility := store.DailyChecklistPrivate
	if request.GetDailyChecklist().GetVisibility() == v1pb.Visibility_PUBLIC {
		visibility = store.DailyChecklistPublic
	}
	checklist, err := s.Store.UpsertDailyChecklist(ctx, &store.DailyChecklist{
		CreatorID:  owner.ID,
		Date:       date,
		Visibility: visibility,
		Payload:    convertDailyChecklistPayloadToStore(request.GetDailyChecklist()),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to save daily checklist: %v", err)
	}
	return convertDailyChecklistFromStore(owner.Username, checklist), nil
}

// DeleteDailyChecklist deletes a checklist owned by the authenticated user.
func (s *APIV1Service) DeleteDailyChecklist(ctx context.Context, request *v1pb.DeleteDailyChecklistRequest) (*emptypb.Empty, error) {
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	owner, date, err := s.resolveDailyChecklistOwner(ctx, request.GetName())
	if err != nil {
		return nil, err
	}
	if owner.ID != currentUser.ID {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	if err := s.Store.DeleteDailyChecklist(ctx, &store.DeleteDailyChecklist{CreatorID: owner.ID, Date: date}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete daily checklist: %v", err)
	}
	return &emptypb.Empty{}, nil
}
