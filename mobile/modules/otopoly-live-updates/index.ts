import { requireOptionalNativeModule } from 'expo';

/** Display-ready content for one job's Live Update (mirrors JobLiveUpdate.kt). */
export type JobLiveUpdate = {
  title: string;
  text: string;
  subText: string;
  /** 0 = in progress, 1 = ready for pickup, 2 = delivered / finished. */
  stage: 0 | 1 | 2;
  /** Status chip text when not in progress (the chip shows the elapsed time while in progress). */
  chipText: string;
  /** Epoch ms; drives the chronometer while in progress. */
  startedAt: number;
  url: string;
  /** False for the final post: dismissible and removed by the system after a while. */
  ongoing: boolean;
  channelName: string;
};

type OtopolyLiveUpdatesModule = {
  areNotificationsEnabled(): boolean;
  /** Android 16+ and Live Updates allowed for the app. */
  canPostPromoted(): boolean;
  post(jobId: string, update: JobLiveUpdate): boolean;
  end(jobId: string): void;
  activeJobIds(): string[];
};

/** Android-only local module; null on iOS, web and Expo Go. */
export default requireOptionalNativeModule<OtopolyLiveUpdatesModule>('OtopolyLiveUpdates');
