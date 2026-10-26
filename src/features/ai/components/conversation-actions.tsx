/**
 * Rename / delete for one assistant conversation (PATCH / DELETE /v1/tenant/ai/conversations/{uuid}):
 * the native action sheet (iOS) or alert (Android), the delete confirmation and the rename sheet.
 * Used by the conversation list (long press, "more" button) and the conversation screen header.
 */
import * as Haptics from 'expo-haptics';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { Button, Sheet, TextField, useConfirm } from '@/components/ui';
import { useDeleteConversation, useRenameConversation } from '@/features/ai/queries';
import type { AIConversation } from '@/features/ai/types';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('ai.conversation_actions');

type Target = Pick<AIConversation, 'uuid' | 'title'>;

export function useConversationActions({ onDeleted }: { onDeleted?: (uuid: string) => void } = {}) {
  const { t: tr } = useLocale();
  const confirm = useConfirm();
  const rename = useRenameConversation();
  const remove = useDeleteConversation(onDeleted);
  const [renaming, setRenaming] = useState<Target | null>(null);
  const [title, setTitle] = useState('');

  const askDelete = useCallback(
    async (conv: Target) => {
      const ok = await confirm({
        title: tr('ai.assistant.delete_title'),
        message: tr('ai.assistant.delete_description'),
        destructive: true,
        confirmLabel: tr('ai.assistant.delete'),
        cancelLabel: tr('ai.assistant.cancel'),
      });
      if (!ok) return;
      log.info('Delete conversation', { uuid: conv.uuid });
      remove.mutate(conv.uuid);
    },
    [confirm, remove, tr],
  );

  const startRename = useCallback((conv: Target) => {
    setTitle(conv.title);
    setRenaming(conv);
  }, []);

  const open = useCallback(
    (conv: Target) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const name = conv.title || tr('ai.assistant.untitled');
      const labels = [tr('ai.assistant.rename'), tr('ai.assistant.delete'), tr('ai.assistant.cancel')];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions({ options: labels, destructiveButtonIndex: 1, cancelButtonIndex: 2, title: name }, (i) => {
          if (i === 0) startRename(conv);
          if (i === 1) void askDelete(conv);
        });
      } else {
        Alert.alert(name, undefined, [
          { text: labels[2], style: 'cancel' },
          { text: labels[1], style: 'destructive', onPress: () => void askDelete(conv) },
          { text: labels[0], onPress: () => startRename(conv) },
        ]);
      }
    },
    [askDelete, startRename, tr],
  );

  const sheet = (
    <Sheet
      visible={renaming !== null}
      onClose={() => setRenaming(null)}
      title={tr('ai.assistant.rename_title')}
      footer={
        <Button
          label={tr('ai.assistant.save')}
          loading={rename.isPending}
          disabled={!title.trim()}
          onPress={() => {
            const target = renaming;
            setRenaming(null);
            if (target && title.trim() && title.trim() !== target.title) rename.mutate({ uuid: target.uuid, title: title.trim() });
          }}
        />
      }
    >
      <TextField label={tr('ai.assistant.rename_label')} value={title} onChangeText={setTitle} placeholder={renaming?.title || tr('ai.assistant.rename_label')} autoFocus maxLength={120} returnKeyType="done" />
    </Sheet>
  );

  return { open, sheet, deleting: remove.isPending };
}
