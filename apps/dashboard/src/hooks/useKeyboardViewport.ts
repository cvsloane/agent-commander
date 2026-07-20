'use client';

import { useEffect, useState } from 'react';
import { calculateKeyboardInset } from '@/components/terminal/viewport';

const KEYBOARD_OPEN_THRESHOLD_PX = 120;

function hasEditableFocus(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true;
  if (active instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'range', 'reset', 'submit'].includes(active.type);
  }
  return active instanceof HTMLElement && active.isContentEditable;
}

export function useKeyboardViewport(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const viewport = window.visualViewport;
      if (!viewport) {
        root.style.removeProperty('--keyboard-inset-height');
        root.removeAttribute('data-virtual-keyboard-open');
        setKeyboardOpen(false);
        return;
      }

      const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
      const keyboardInset = calculateKeyboardInset(layoutHeight, viewport);
      const screenInset = Math.max(0, window.screen.height - viewport.height - viewport.offsetTop);
      const nextKeyboardOpen = window.matchMedia('(max-width: 767px)').matches
        && hasEditableFocus()
        && Math.max(keyboardInset, screenInset) >= KEYBOARD_OPEN_THRESHOLD_PX;

      root.style.setProperty('--keyboard-inset-height', `${keyboardInset}px`);
      if (nextKeyboardOpen) root.setAttribute('data-virtual-keyboard-open', 'true');
      else root.removeAttribute('data-virtual-keyboard-open');
      setKeyboardOpen((current) => current === nextKeyboardOpen ? current : nextKeyboardOpen);
    };

    const updateAfterFocus = () => window.requestAnimationFrame(update);
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('focusin', updateAfterFocus);
    document.addEventListener('focusout', updateAfterFocus);

    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
      document.removeEventListener('focusin', updateAfterFocus);
      document.removeEventListener('focusout', updateAfterFocus);
      root.style.removeProperty('--keyboard-inset-height');
      root.removeAttribute('data-virtual-keyboard-open');
    };
  }, []);

  return keyboardOpen;
}
