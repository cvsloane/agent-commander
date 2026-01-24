'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  action: string;
  danger?: boolean;
}

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  dismissDistance?: number;
  onAction: (action: string) => void;
  onClose: () => void;
}

export function ContextMenu({
  open,
  x,
  y,
  items,
  dismissDistance = 150,
  onAction,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef({ x, y });

  useEffect(() => {
    if (open) {
      originRef.current = { x, y };
    }
  }, [open, x, y]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !open) return;

    menu.style.left = `${x + 10}px`;
    menu.style.top = `${y - 10}px`;
    menu.classList.add('visible');

    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (rect.right > viewportWidth - 10) {
      menu.style.left = `${x - rect.width - 10}px`;
    }
    if (rect.bottom > viewportHeight - 10) {
      menu.style.top = `${y - rect.height + 10}px`;
    }
  }, [open, x, y, items]);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      const origin = originRef.current;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > dismissDistance) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      const pressed = event.key.toUpperCase();
      const match = items.find((item) => item.key.toUpperCase() === pressed);
      if (match) {
        event.preventDefault();
        onAction(match.action);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dismissDistance, items, onAction, onClose, open]);

  return (
    <div
      ref={menuRef}
      className={`context-menu${open ? ' visible' : ''}`}
      style={{ left: open ? x : -9999, top: open ? y : -9999 }}
    >
      <div className="context-menu-items">
        {items.map((item) => (
          <div
            key={`${item.action}-${item.label}`}
            className={`context-menu-item${item.danger ? ' danger' : ''}`}
            data-action={item.action}
            onClick={() => onAction(item.action)}
          >
            <span className="context-menu-key">{item.key}</span>
            <span className="context-menu-label">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="context-menu-hint">Move elsewhere to dismiss</div>
    </div>
  );
}
