import type { CSSProperties, ReactNode } from 'react';

/**
 * Thin wrappers that match the settings-card primitives used in openscad-studio.
 * Grouping related controls into titled cards makes a long settings dialog
 * scannable without turning into a wall of form rows.
 */

interface SettingsCardProps {
  children: ReactNode;
  'data-testid'?: string;
}

export function SettingsCard({ children, ...rest }: SettingsCardProps) {
  return (
    <div className="pd-settings-card" {...rest}>
      {children}
    </div>
  );
}

interface SettingsCardHeaderProps {
  title: string;
  description?: string;
}

export function SettingsCardHeader({ title, description }: SettingsCardHeaderProps) {
  return (
    <div className="pd-settings-card__header">
      <h3 className="pd-settings-card__title">{title}</h3>
      {description ? (
        <p className="pd-settings-card__description">{description}</p>
      ) : null}
    </div>
  );
}

interface SettingsCardSectionProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function SettingsCardSection({
  children,
  className,
  style,
}: SettingsCardSectionProps) {
  return (
    <div
      className={`pd-settings-card__section${className ? ` ${className}` : ''}`}
      style={style}
    >
      {children}
    </div>
  );
}
