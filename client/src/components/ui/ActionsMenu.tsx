import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuAction {
  /** Visible text. */
  label: string;
  /** Accessible name (e.g. including the candidate name). Defaults to label. */
  ariaLabel?: string;
  icon?: IconName;
  onSelect: () => void;
}

interface Props {
  /** Accessible name of the trigger, e.g. "More actions for Priya Sharma". */
  label: string;
  actions: MenuAction[];
  disabled?: boolean;
}

const MENU_WIDTH = 240;

/**
 * "⋯" button that opens a small menu of row actions. Rendered with fixed positioning so it is never
 * clipped by a scrolling table, and follows its button while the page scrolls.
 * Keyboard: Enter/Space/ArrowDown open; arrows move; Escape closes.
 */
export function ActionsMenu({ label, actions, disabled = false }: Props) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = position !== null;

  const close = useCallback((focusTrigger = false) => {
    setPosition(null);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  /** Places the menu under its button (or above it when there is no room below). */
  const computePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const itemHeight = 44;
    const height = actions.length * itemHeight + 12;
    const below = rect.bottom + 6;
    const top = below + height > window.innerHeight && rect.top - height - 6 > 0 ? rect.top - height - 6 : below;
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    return { top, left, triggerVisible: rect.bottom > 0 && rect.top < window.innerHeight };
  }, [actions.length]);

  const openMenu = () => {
    const next = computePosition();
    if (next) setPosition({ top: next.top, left: next.left });
  };

  // Focus the first item when the menu opens.
  useEffect(() => {
    if (open) itemsRef.current[0]?.focus({ preventScroll: true });
  }, [open]);

  // Close on outside click, scroll or resize.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !document.getElementById(menuId)?.contains(target)) close();
    };
    // Keep the menu attached to its button while the page or table scrolls or resizes;
    // close it only when the button leaves the screen.
    const onViewportChange = () => {
      const next = computePosition();
      if (!next || !next.triggerVisible) close();
      else setPosition((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : { top: next.top, left: next.left }));
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, close, menuId, computePosition]);

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      openMenu();
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemsRef.current.filter(Boolean) as HTMLButtonElement[];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus({ preventScroll: true });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (e.key === 'Tab') {
      close();
    }
  };

  if (actions.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="button-secondary button-small button-icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
      >
        <Icon name="moreHorizontal" size={20} />
      </button>
      {open && position && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="actions-menu"
          style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
          onKeyDown={onMenuKey}
        >
          {actions.map((action, i) => (
            <button
              key={action.label}
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className="actions-menu-item"
              aria-label={action.ariaLabel ?? action.label}
              onClick={() => {
                close(true);
                action.onSelect();
              }}
            >
              {action.icon && <Icon name={action.icon} size={16} />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
