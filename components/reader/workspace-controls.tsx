"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

type DialogContextValue = {
  close: (options?: { restoreFocus?: boolean }) => void;
  titleId: string;
  descriptionId: string;
};
const DialogContext = createContext<DialogContextValue | null>(null);

export function ReaderDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const invokingElementRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback((options?: { restoreFocus?: boolean }) => {
    const dialog = ref.current;
    restoreFocusRef.current = options?.restoreFocus ?? true;
    if (dialog?.open) dialog.close();
    else onOpenChange(false);
  }, [onOpenChange]);

  const handleClose = useCallback(() => {
    const invokingElement = invokingElementRef.current;
    const shouldRestoreFocus = restoreFocusRef.current;
    invokingElementRef.current = null;
    restoreFocusRef.current = true;
    onOpenChange(false);
    if (!shouldRestoreFocus || !invokingElement?.isConnected) return;
    queueMicrotask(() => {
      if (invokingElement.isConnected) invokingElement.focus();
    });
  }, [onOpenChange]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const activeElement = document.activeElement;
      invokingElementRef.current =
        activeElement instanceof HTMLElement ? activeElement : null;
      restoreFocusRef.current = true;
      dialog.showModal();
      return;
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="reader-native-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={handleClose}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <DialogContext.Provider value={{ close, titleId, descriptionId }}>
        {children}
      </DialogContext.Provider>
    </dialog>
  );
}

export function ReaderDialogContent({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { close } = useDialog();
  return (
    <div className={className} data-reader-dialog-content>
      <button
        type="button"
        className="reader-dialog-close"
        aria-label="关闭"
        onClick={() => close()}
      >
        <X size={16} aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

export function ReaderDialogTitle({ children }: { children: ReactNode }) {
  const { titleId } = useDialog();
  return (
    <h2 id={titleId} data-reader-dialog-title>
      {children}
    </h2>
  );
}

export function ReaderDialogDescription({ children }: { children: ReactNode }) {
  const { descriptionId } = useDialog();
  return (
    <p id={descriptionId} data-reader-dialog-description>
      {children}
    </p>
  );
}

function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context)
    throw new Error("Reader dialog content must be inside ReaderDialog.");
  return context;
}

export function useReaderDialog(): DialogContextValue {
  return useDialog();
}

type MenuContextValue = { close: () => void };
const MenuContext = createContext<MenuContextValue | null>(null);

export function ReaderMenu({
  trigger,
  children,
}: {
  trigger: (toggle: () => void, open: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        rootRef.current
          ?.querySelector<HTMLButtonElement>(":scope > button")
          ?.focus();
        close();
        return;
      }
      if (event.key === "Tab") {
        close();
        return;
      }
      if (
        !menuRef.current ||
        !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      )
        return;
      const items = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        ),
      );
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
              items.length;
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    );
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [close, open]);

  return (
    <div className="reader-menu" ref={rootRef}>
      {trigger(() => setOpen((current) => !current), open)}
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div ref={menuRef} className="reader-menu-content" role="menu">
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

export function ReaderMenuItem({
  children,
  onSelect,
  disabled = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const menu = useContext(MenuContext);
  return (
    <button
      type="button"
      className="reader-menu-item"
      role="menuitem"
      aria-disabled={disabled ? "true" : undefined}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect();
        menu?.close();
      }}
    >
      {children}
    </button>
  );
}

export function ReaderMenuLink({
  href,
  target,
  children,
}: {
  href: string;
  target?: string;
  children: ReactNode;
}) {
  const menu = useContext(MenuContext);
  return (
    <a
      className="reader-menu-item"
      role="menuitem"
      href={href}
      target={target}
      onClick={() => menu?.close()}
    >
      {children}
    </a>
  );
}

export function ReaderMenuSeparator() {
  return <div className="reader-menu-separator" role="separator" />;
}
