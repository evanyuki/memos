import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useResolvedUsersByNames } from "@/components/MemoContent/MentionResolutionContext";
import { memoServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { memoKeys } from "@/hooks/useMemoQueries";
import { type Memo, type Reaction, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import type { User } from "@/types/proto/api/v1/user_service_pb";

export interface ReactionGroupItem {
  users: User[];
  guestCount: number;
  hasCurrentUser: boolean;
}

export type ReactionGroup = Map<string, ReactionGroupItem>;

export const useReactionGroups = (reactions: Reaction[]): ReactionGroup => {
  const creatorNames = useMemo(() => reactions.flatMap((reaction) => (reaction.creator ? [reaction.creator] : [])), [reactions]);
  const userMap = useResolvedUsersByNames(creatorNames);

  return useMemo(() => {
    const reactionGroup = new Map<string, ReactionGroupItem>();
    for (const reaction of reactions) {
      const group = reactionGroup.get(reaction.reactionType) ?? { users: [], guestCount: 0, hasCurrentUser: false };
      if (reaction.creator) {
        const user = userMap?.get(reaction.creator);
        if (!user) continue;
        group.users.push(user);
      } else {
        group.guestCount += 1;
      }
      group.hasCurrentUser ||= reaction.isCurrentUser;
      reactionGroup.set(reaction.reactionType, group);
    }
    return reactionGroup;
  }, [reactions, userMap]);
};

export const useCanReact = (memo: Memo): boolean => {
  const currentUser = useCurrentUser();
  const { profile } = useInstance();
  return Boolean(currentUser || (profile.instanceUrl && memo.visibility === Visibility.PUBLIC));
};

interface UseReactionActionsOptions {
  memo: Memo;
  onComplete?: () => void;
}

export const useReactionActions = ({ memo, onComplete }: UseReactionActionsOptions) => {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();

  const isOwnReaction = (reaction: Reaction) => {
    return currentUser ? reaction.creator === currentUser.name : reaction.isCurrentUser;
  };

  const hasReacted = (reactionType: string) => {
    return memo.reactions.some((reaction) => reaction.reactionType === reactionType && isOwnReaction(reaction));
  };

  const handleReactionClick = async (reactionType: string) => {
    try {
      if (hasReacted(reactionType)) {
        const reactions = memo.reactions.filter((reaction) => reaction.reactionType === reactionType && isOwnReaction(reaction));
        await Promise.all(reactions.map((reaction) => memoServiceClient.deleteMemoReaction({ name: reaction.name })));
      } else {
        await memoServiceClient.upsertMemoReaction({
          name: memo.name,
          reaction: { contentId: memo.name, reactionType },
        });
      }
      // Refetch the memo to get updated reactions and invalidate cache
      const updatedMemo = await memoServiceClient.getMemo({ name: memo.name });
      queryClient.setQueryData(memoKeys.detail(memo.name), updatedMemo);
      queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
      // If this memo is a comment, refresh the parent's comments list so the comment's reactions update in the UI
      if (memo.parent) {
        queryClient.invalidateQueries({ queryKey: memoKeys.comments(memo.parent) });
      }
    } catch {
      // skip error
    }
    onComplete?.();
  };

  return { hasReacted, handleReactionClick };
};

export const formatReactionTooltip = (users: User[], guestCount: number, reactionType: string): string => {
  if (users.length === 0 && guestCount === 0) return "";
  const formatUserName = (user: User) => user.displayName || user.username;
  const names = users.slice(0, 4).map(formatUserName);
  const remainingUsers = Math.max(0, users.length - names.length);
  if (guestCount > 0) {
    names.push(`${guestCount} ${guestCount === 1 ? "guest" : "guests"}`);
  }
  if (remainingUsers > 0) {
    names.push(`${remainingUsers} more`);
  }
  return `${names.join(", ")} reacted with ${reactionType.toLowerCase()}`;
};
