import { CircleCheck, CircleHelp, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { formatPpi } from '../engine/index.js';
import { healthLabel } from '../ui/labels.js';
import styles from './HealthBadge.module.css';

const ICONS = {
  'meets-target': CircleCheck,
  'below-target': Info,
  warning: TriangleAlert,
  critical: OctagonAlert,
  unknown: CircleHelp,
};

/** Each resolution status maps onto one of the shared badge tones. */
const TONES = {
  'meets-target': 'success',
  'below-target': 'info',
  warning: 'warning',
  critical: 'error',
  unknown: 'neutral',
};

/**
 * Resolution status with an icon and a text label (never colour alone).
 *
 * @param {{ status: string, reason?: string, ppi?: number | null, size?: 'sm' | 'md' }} props
 */
export default function HealthBadge({ status, reason, ppi = null, size = 'md' }) {
  const Icon = ICONS[status] ?? CircleHelp;
  return (
    <span className={`badge ${styles.badge}`} data-tone={TONES[status] ?? 'neutral'} data-status={status} data-size={size}>
      <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      <span>
        {healthLabel(status, reason)}
        {ppi !== null && Number.isFinite(ppi) ? ` · ${formatPpi(ppi)}` : ''}
      </span>
    </span>
  );
}
