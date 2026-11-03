import { cn } from '@/lib/utils/cn';

const CODE_LENGTH = 4;

/** One real numeric input drawn as four engraved slots; the slots are presentation only. */
export function RoomCodeInput({
  value,
  onChange,
  disabled,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const active = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <label className={cn('home-code', className)}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        // The caret is invisible, so pin it to the end: typing always fills the next slot.
        onSelect={(event) => {
          const input = event.currentTarget;
          const end = input.value.length;
          if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
        }}
        disabled={disabled}
        aria-label={label}
        maxLength={CODE_LENGTH}
        inputMode="numeric"
        pattern="[0-9]{4}"
        autoComplete="off"
        className="home-code-input"
      />
      {Array.from({ length: CODE_LENGTH }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="home-code-cell room-code"
          data-active={index === active ? '' : undefined}
          data-filled={index < value.length ? '' : undefined}
        >
          {value[index]}
        </span>
      ))}
    </label>
  );
}
