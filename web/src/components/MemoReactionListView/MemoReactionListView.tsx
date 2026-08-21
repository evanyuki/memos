import { memo } from "react";
import { State } from "@/types/proto/api/v1/common_pb";
import type { Memo, Reaction } from "@/types/proto/api/v1/memo_service_pb";
import { useReactionGroups } from "./hooks";
import ReactionSelector from "./ReactionSelector";
import ReactionView from "./ReactionView";

interface Props {
  memo: Memo;
  reactions: Reaction[];
}

const MemoReactionListView = (props: Props) => {
  const { memo: memoData, reactions } = props;
  const reactionGroup = useReactionGroups(reactions);
  const readonly = memoData.state === State.ARCHIVED;

  if (reactions.length === 0) {
    return null;
  }

  return (
    <div className="w-full flex flex-row justify-start items-start flex-wrap gap-1 select-none">
      {Array.from(reactionGroup).map(([reactionType, group]) => (
        <ReactionView
          key={reactionType}
          memo={memoData}
          reactionType={reactionType}
          users={group.users}
          guestCount={group.guestCount}
          hasCurrentUser={group.hasCurrentUser}
        />
      ))}
      {!readonly && <ReactionSelector memo={memoData} />}
    </div>
  );
};

export default memo(MemoReactionListView);
