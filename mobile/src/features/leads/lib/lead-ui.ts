/** Ported from web `features/leads/lib/lead-ui.ts`. */
import type { Tone } from '@/components/ui';
import type { Customer } from '@/features/customers/services/customers.service';
import type { LeadStatus, LeadTemperature } from '@/features/leads/types';

export function leadStatusTone(status: LeadStatus): Tone {
  switch (status) {
    case 'contacted':
    case 'quoted':
      return 'warning';
    case 'won':
      return 'success';
    case 'lost':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Web TEMPERATURE_CLASSES: cold = sky, warm = amber, hot = rose. */
export const TEMPERATURE_TONE: Record<LeadTemperature, Tone> = { cold: 'info', warm: 'warning', hot: 'danger' };

export const OPEN_LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'quoted'];

/** Stepper order (lost is off-path). */
export const LEAD_STEPS: LeadStatus[] = ['new', 'contacted', 'quoted', 'won'];

/** Next step in the happy path (the one-tap "advance" action). */
export function nextLeadStatus(status: LeadStatus): LeadStatus | null {
  switch (status) {
    case 'new':
      return 'contacted';
    case 'contacted':
      return 'quoted';
    case 'quoted':
      return 'won';
    default:
      return null;
  }
}

/**
 * Minimal `Customer` for pre-selecting the shared CustomerPicker from a lead / quote
 * (web `PickedCustomer` = uuid + name + phone). Only these fields are read by the picker.
 */
export function pickedCustomer(uuid: string, name: string, phone = ''): Customer {
  return { uuid, name, phone, email: '', kind: 'individual', notes: '', tax_id: '', tax_office: '', is_active: true, vehicle_count: 0, created_at: '', updated_at: '' };
}
