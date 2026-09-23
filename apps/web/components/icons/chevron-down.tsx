type ChevronDownIconProps = {
  className?: string;
  size?: number;
};

export function ChevronDownIcon({ className, size = 16 }: ChevronDownIconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}
