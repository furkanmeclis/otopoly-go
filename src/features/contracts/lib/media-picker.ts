/**
 * Picking contract media on the device: camera, photo library and the Files picker.
 * Returns `UploadFile`s ready for `contractsService.uploadMedia`. The backend sniffs the bytes and
 * only accepts JPEG/PNG/WebP/GIF images and PDF (12 MB body cap), so the same rules apply here:
 * photos are re-encoded (`quality < 1` makes iOS hand back JPEG instead of HEIC) and anything else
 * is rejected before upload.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback } from 'react';
import { Linking } from 'react-native';

import type { UploadFile } from '@/api/files';
import { useToast } from '@/components/feedback/toast';
import { useConfirm } from '@/components/ui';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';

const log = createLogger('contracts.media-picker');

/** Mirrors the API upload cap (handler caps contract media bodies at 12 MB). */
export const MEDIA_MAX_BYTES = 12 * 1024 * 1024;
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const PHOTO_QUALITY = 0.8;
const MAX_PICK = 10;

const EXT_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };

function typeFromName(name: string) {
  return EXT_TYPES[name.toLowerCase().split('.').pop() ?? ''];
}

export function photoToUpload(asset: ImagePicker.ImagePickerAsset, index = 0): UploadFile {
  const type = (asset.mimeType ?? typeFromName(asset.fileName ?? asset.uri) ?? 'image/jpeg').toLowerCase();
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/gif' ? 'gif' : 'jpg';
  const name = asset.fileName?.trim() || `photo-${Date.now()}-${index + 1}.${ext}`;
  return { uri: asset.uri, name, type, size: asset.fileSize };
}

export function documentToUpload(asset: DocumentPicker.DocumentPickerAsset): UploadFile {
  const type = (asset.mimeType ?? typeFromName(asset.name) ?? 'application/octet-stream').toLowerCase();
  return { uri: asset.uri, name: asset.name, type, size: asset.size };
}

export type MediaRejection = { name: string; reason: 'type' | 'size' };

/** Splits picked files into uploadable ones and rejections (wrong type or over the size cap). */
export function screenMedia(files: UploadFile[]): { accepted: UploadFile[]; rejected: MediaRejection[] } {
  const accepted: UploadFile[] = [];
  const rejected: MediaRejection[] = [];
  for (const f of files) {
    if (!MEDIA_TYPES.includes(f.type)) rejected.push({ name: f.name, reason: 'type' });
    else if (f.size && f.size > MEDIA_MAX_BYTES) rejected.push({ name: f.name, reason: 'size' });
    else accepted.push(f);
  }
  return { accepted, rejected };
}

/**
 * Camera / library / file pickers with permission handling and the shared upload rules.
 * Each picker resolves to the accepted files (empty when cancelled or nothing was usable).
 */
export function useMediaPicker({ photosOnly = false }: { photosOnly?: boolean } = {}) {
  const { t: tr } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();

  const finish = useCallback(
    (files: UploadFile[]) => {
      const { accepted, rejected } = screenMedia(files);
      for (const r of rejected) {
        toast.error(r.reason === 'size' ? tr('contracts.job.photos_too_large', { name: r.name }) : tr('mobile.uploads.media_type_rejected', { name: r.name }));
      }
      return accepted;
    },
    [toast, tr],
  );

  const takePhoto = useCallback(async (): Promise<UploadFile[]> => {
    try {
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        log.warn('Camera permission denied', { canAskAgain: perm.canAskAgain });
        const open = await confirm({
          title: tr('mobile.uploads.camera_denied_title'),
          message: tr('mobile.uploads.camera_denied_message'),
          confirmLabel: tr('mobile.uploads.open_settings'),
        });
        if (open) await Linking.openSettings();
        return [];
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: PHOTO_QUALITY, exif: false });
      if (result.canceled) return [];
      return finish(result.assets.map(photoToUpload));
    } catch (error) {
      log.error('Camera failed', { error });
      toast.error(tr('mobile.uploads.picker_failed'));
      return [];
    }
  }, [confirm, finish, toast, tr]);

  const pickPhotos = useCallback(async (): Promise<UploadFile[]> => {
    try {
      // The system photo picker needs no library permission on iOS 14+ / Android 13+.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_PICK,
        quality: PHOTO_QUALITY,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        exif: false,
      });
      if (result.canceled) return [];
      return finish(result.assets.map(photoToUpload));
    } catch (error) {
      log.error('Photo library failed', { error });
      toast.error(tr('mobile.uploads.picker_failed'));
      return [];
    }
  }, [finish, toast, tr]);

  const pickFiles = useCallback(async (): Promise<UploadFile[]> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: photosOnly ? MEDIA_TYPES.filter((m) => m.startsWith('image/')) : MEDIA_TYPES,
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return [];
      return finish(result.assets.map(documentToUpload));
    } catch (error) {
      log.error('Document picker failed', { error });
      toast.error(tr('mobile.uploads.picker_failed'));
      return [];
    }
  }, [finish, photosOnly, toast, tr]);

  return { takePhoto, pickPhotos, pickFiles };
}
