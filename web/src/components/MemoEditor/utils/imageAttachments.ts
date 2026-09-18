import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { extractAttachmentUIDFromName, extractManagedAttachmentUIDs, removeManagedAttachmentReferences } from "@/utils/managed-attachment";
import { type AttachmentItem, type LocalFile, toAttachmentItems } from "../types/attachment";

/** The composer manages uploaded images in its visual tray, including images in older Markdown drafts. */
export function normalizeImageAttachments(content: string, attachments: Attachment[]) {
  const referencedUIDs = extractManagedAttachmentUIDs(content);
  const availableUIDs = new Set(
    attachments.map((attachment) => extractAttachmentUIDFromName(attachment.name)).filter((uid): uid is string => !!uid),
  );
  const managedUIDs = new Set([...referencedUIDs].filter((uid) => availableUIDs.has(uid)));
  if (managedUIDs.size === 0) return { content, attachments };

  const items = toAttachmentItems(attachments);
  const byName = new Map(attachments.map((attachment) => [attachment.name, attachment]));
  const ordered: AttachmentItem[] = [];
  for (const uid of managedUIDs) {
    const item = items.find((candidate) => candidate.memberIds.includes(`attachments/${uid}`));
    if (item && !ordered.includes(item)) ordered.push(item);
  }
  ordered.push(...items.filter((item) => !ordered.includes(item)));
  return {
    content: removeManagedAttachmentReferences(content, managedUIDs).replace(/^\n+|\n+$/g, ""),
    attachments: ordered.flatMap((item) => item.memberIds.map((name) => byName.get(name)!)),
  };
}

export function moveAttachmentItem(items: AttachmentItem[], sourceID: string, targetID: string): AttachmentItem[] {
  const from = items.findIndex((item) => item.id === sourceID);
  const to = items.findIndex((item) => item.id === targetID);
  if (from < 0 || to < 0 || from === to) return items;
  const result = [...items];
  result.splice(to, 0, result.splice(from, 1)[0]!);
  return result;
}

export const isValidImageFilename = (filename: string): boolean =>
  filename.trim().length > 0 &&
  filename.trim() !== "." &&
  filename.trim() !== ".." &&
  !/[\\/]/.test(filename) &&
  [...filename].every((character) => character.charCodeAt(0) >= 32);

export function renameLocalFile(localFile: LocalFile, filename: string): LocalFile {
  return {
    ...localFile,
    file: new File([localFile.file], filename, { type: localFile.file.type, lastModified: localFile.file.lastModified }),
  };
}
