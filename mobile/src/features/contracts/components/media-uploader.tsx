/**
 * Contract gallery upload (web instance detail drop zone): optional caption, then camera, photo
 * library or Files. Picked files are uploaded one by one, like the web `uploadFiles` loop.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Camera, FileUp, ImagePlus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { UploadFile } from '@/api/files';
import { useApiErrorMessage, useToast } from '@/components/feedback/toast';
import { Button, Card, Row, TextField, Txt } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

import { useMediaPicker } from '../lib/media-picker';
import { contractKeys } from '../queries';
import { contractsService } from '../services/contracts.service';

const log = createLogger('contracts.media-uploader');

export function MediaUploader({ instanceUuid }: { instanceUuid: string }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const qc = useQueryClient();
  const picker = useMediaPicker();
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const upload = async (pick: () => Promise<UploadFile[]>) => {
    const files = await pick();
    if (files.length === 0) return;
    const note = caption.trim() || undefined;
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const [index, file] of files.entries()) {
      setProgress({ done: index, total: files.length });
      try {
        await contractsService.uploadMedia(instanceUuid, file, note);
      } catch (error) {
        log.warn('Media upload failed', { name: file.name, error });
        failed.push(file.name);
        lastError = error;
      }
    }
    setProgress(null);
    await qc.invalidateQueries({ queryKey: contractKeys.all });
    if (failed.length > 0) toast.error(tr('contracts.job.photos_failed', { names: failed.join(', ') }), toMessage(lastError));
    if (failed.length < files.length) {
      toast.success(tr('contracts.instances.toast.media'));
      setCaption('');
    }
  };

  const busy = progress !== null;
  return (
    <Card style={{ gap: t.spacing.md }}>
      <View style={{ gap: 2 }}>
        <Txt variant="bodyStrong">{tr('mobile.uploads.media_title')}</Txt>
        <Txt variant="caption" tone="secondary">
          {tr('contracts.instances.gallery_drop_hint')}
        </Txt>
      </View>
      <TextField label={tr('contracts.instances.gallery_caption')} value={caption} onChangeText={setCaption} placeholder={tr('contracts.instances.gallery_caption')} editable={!busy} />
      <Row gap={t.spacing.sm} wrap>
        <Button size="sm" variant="secondary" disabled={busy} icon={<Camera size={16} color={t.colors.primary} />} label={tr('contracts.job.photos_take')} onPress={() => upload(picker.takePhoto)} />
        <Button size="sm" variant="secondary" disabled={busy} icon={<ImagePlus size={16} color={t.colors.primary} />} label={tr('contracts.job.photos_pick')} onPress={() => upload(picker.pickPhotos)} />
        <Button size="sm" variant="outline" disabled={busy} icon={<FileUp size={16} color={t.colors.text} />} label={tr('contracts.instances.gallery_upload')} onPress={() => upload(picker.pickFiles)} />
      </Row>
      {progress ? (
        <Txt variant="caption" tone="secondary" accessibilityLiveRegion="polite">
          {tr('mobile.uploads.uploading', { done: progress.done + 1, total: progress.total })}
        </Txt>
      ) : null}
    </Card>
  );
}
