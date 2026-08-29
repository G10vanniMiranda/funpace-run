import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

type StatusTone = 'success' | 'warning' | 'error' | 'info';

const tones = {
  success: { className: 'border-emerald-800 bg-emerald-50 text-emerald-900', icon: CheckCircle2 },
  warning: { className: 'border-amber-700 bg-amber-50 text-amber-900', icon: AlertTriangle },
  error: { className: 'border-red-800 bg-red-50 text-red-900', icon: XCircle },
  info: { className: 'border-sky-800 bg-sky-50 text-sky-900', icon: Info },
} satisfies Record<StatusTone, { className: string; icon: typeof Info }>;

export function StatusMessage({ tone, title, children }: { tone: StatusTone; title: string; children: ReactNode }) {
  const styles = tones[tone];
  const Icon = styles.icon;

  return (
    <div
      className={`ui-surface-form flex gap-3 border p-3 text-xs font-bold leading-relaxed shadow-sm transition-opacity ${styles.className}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 wrap-break-word">
        <p className="ui-label mb-1">{title}</p>
        <div className="normal-case tracking-normal">{children}</div>
      </div>
    </div>
  );
}
