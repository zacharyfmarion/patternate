import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type PropsWithChildren, type ReactNode } from 'react';
import { IconButton } from './ui';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: PropsWithChildren<Props>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="pd-dialog-overlay" />
        <Dialog.Content className="pd-dialog-content">
          <header className="pd-dialog-header">
            <div className="pd-dialog-header-copy">
              <Dialog.Title className="pd-dialog-title">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="pd-dialog-description">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <IconButton size="sm" title="Close" aria-label="Close">
                <X size={18} />
              </IconButton>
            </Dialog.Close>
          </header>

          <div className="pd-dialog-body">{children}</div>

          {footer ? <footer className="pd-dialog-footer">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
