import {
  cloneElement,
  isValidElement,
  type AriaAttributes,
  type ReactElement,
  type ReactNode,
  useId,
} from 'react';
import { AlertCircle } from 'lucide-react';

type FieldControlProps = {
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  'aria-describedby'?: string;
};

type FormFieldProps = {
  id?: string;
  name: string;
  label: string;
  description?: ReactNode;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  children: ReactElement<FieldControlProps>;
};

const labelClass = 'ui-label text-[11px] sm:text-xs';
const errorClass = 'ui-meta flex items-start gap-1.5 text-[11px] leading-relaxed text-red-700 sm:text-xs';

export function FormField({
  id,
  name,
  label,
  description,
  error,
  required = false,
  disabled = false,
  autoComplete,
  children,
}: FormFieldProps) {
  const generatedId = useId().replaceAll(':', '');
  const controlId = id ?? `field-${generatedId}`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;

  if (!isValidElement<FieldControlProps>(children)) {
    return null;
  }

  const describedBy = [
    children.props['aria-describedby'],
    description ? descriptionId : undefined,
    error ? errorId : undefined,
  ].filter(Boolean).join(' ') || undefined;

  const control = cloneElement(children, {
    id: controlId,
    name,
    required: required || children.props.required,
    disabled: disabled || children.props.disabled,
    autoComplete: autoComplete ?? children.props.autoComplete,
    'aria-invalid': error ? 'true' : 'false',
    'aria-describedby': describedBy,
  });

  return (
    <div className="min-w-0 space-y-2" data-field-state={error ? 'error' : disabled ? 'disabled' : 'default'}>
      <label className={labelClass} htmlFor={controlId}>
        {label}
        {required && <span className="sr-only"> (obrigatório)</span>}
      </label>
      {description && (
        <p id={descriptionId} className="ui-meta text-xs normal-case tracking-normal text-black/65">
          {description}
        </p>
      )}
      {control}
      {error && (
        <p id={errorId} className={errorClass}>
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span><span className="sr-only">Erro: </span>{error}</span>
        </p>
      )}
    </div>
  );
}
