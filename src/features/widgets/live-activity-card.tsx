import { Radio } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useToast } from '@/components/feedback/toast';
import { Card, Row, SwitchRow } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-provider';
import type { JobDetail } from '@/features/jobs/services/jobs.service';
import { useLocale } from '@/lib/i18n/provider';
import { createLogger } from '@/lib/logger';
import { useTheme } from '@/theme/provider';

import { endJobActivity, findJobActivity, startJobActivity, updateJobActivity, liveActivitiesAvailable } from './bridge';
import { buildJobActivityProps } from './props';

const log = createLogger('widgets.live');

/**
 * Job detail toggle for the Lock Screen / Dynamic Island Live Activity.
 * Hidden where Live Activities are unavailable (Expo Go, Android) and for jobs that already left the bay.
 */
export function LiveActivityCard({ job }: { job: JobDetail }) {
  const t = useTheme();
  const { t: tr } = useLocale();
  const { organization } = useAuth();
  const toast = useToast();
  const available = liveActivitiesAvailable();
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState(false);
  const orgName = organization?.name ?? '';
  /** Last props pushed to the activity: a refetch that changes nothing visible must not update it again. */
  const pushed = useRef<string | null>(null);

  useEffect(() => {
    if (!available) return;
    let alive = true;
    findJobActivity(job.uuid).then((a) => alive && setTracking(Boolean(a)));
    return () => {
      alive = false;
    };
  }, [available, job.uuid]);

  // Mirror status changes made on this screen (ready, deliver, cancel) straight away.
  useEffect(() => {
    if (!available || !tracking) {
      pushed.current = null;
      return;
    }
    let alive = true;
    (async () => {
      const activity = await findJobActivity(job.uuid);
      const props = buildJobActivityProps(job, orgName, tr);
      const key = props ? JSON.stringify(props) : null;
      if (!activity) {
        if (alive) setTracking(false);
        return;
      }
      if (!props) {
        await endJobActivity(job.uuid);
        if (alive) setTracking(false);
        return;
      }
      if (key !== pushed.current) {
        await updateJobActivity(activity, props);
        pushed.current = key;
      }
      if (alive && (props.status === 'delivered' || props.status === 'cancelled')) setTracking(false);
    })();
    return () => {
      alive = false;
    };
  }, [available, tracking, job, orgName, tr]);

  const open = job.status === 'in_progress' || job.status === 'ready';
  if (!available || (!open && !tracking)) return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const props = buildJobActivityProps(job, orgName, tr);
        const ok = props ? await startJobActivity(props) : false;
        setTracking(ok);
        if (ok) toast.success(tr('mobile.live.started'));
        else toast.error(tr('mobile.live.failed'));
      } else {
        await endJobActivity(job.uuid);
        setTracking(false);
        toast.info(tr('mobile.live.stopped'));
      }
    } catch (error) {
      log.error('Live Activity toggle failed', error);
      toast.error(tr('mobile.live.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row gap={t.spacing.md} style={{ alignItems: 'center' }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Radio size={18} color={t.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <SwitchRow
            label={tr('mobile.live.title')}
            description={tracking ? tr('mobile.live.active') : tr('mobile.live.description')}
            value={tracking}
            onValueChange={toggle}
            disabled={busy || !open}
          />
        </View>
      </Row>
    </Card>
  );
}
