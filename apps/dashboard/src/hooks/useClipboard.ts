'use client';

import { useState, useCallback } from 'react';

interface UseClipboardReturn {
  copyToClipboard: (text: string) => Promise<boolean>;
  readFromClipboard: () => Promise<string | null>;
  copied: boolean;
  error: string | null;
  isSupported: boolean;
}

/**
 * Hook for clipboard operations with fallbacks for mobile Safari and older browsers.
 * Uses the modern Clipboard API when available, falls back to execCommand for copy.
 */
export function useClipboard(): UseClipboardReturn {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if Clipboard API is supported
  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof window !== 'undefined' &&
    window.isSecureContext;

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    setError(null);

    try {
      if (isSupported) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: hidden textarea for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);

        // Handle iOS Safari which needs a range selection
        if (navigator.userAgent.match(/ipad|iphone/i)) {
          const range = document.createRange();
          range.selectNodeContents(textarea);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          textarea.setSelectionRange(0, text.length);
        } else {
          textarea.select();
        }

        const success = document.execCommand('copy');
        document.body.removeChild(textarea);

        if (!success) {
          throw new Error('execCommand copy failed');
        }
      }

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      // Haptic feedback if available
      if ('vibrate' in navigator) {
        navigator.vibrate(10);
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Copy failed';
      setError(message);
      setCopied(false);
      return false;
    }
  }, [isSupported]);

  const readFromClipboard = useCallback(async (): Promise<string | null> => {
    setError(null);

    // Reading clipboard requires Clipboard API - no fallback available
    if (!isSupported) {
      setError('Clipboard read not supported. Please paste manually.');
      return null;
    }

    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (err) {
      // iOS Safari and some browsers block clipboard read
      setError('Clipboard access denied. Please paste manually.');
      return null;
    }
  }, [isSupported]);

  return {
    copyToClipboard,
    readFromClipboard,
    copied,
    error,
    isSupported,
  };
}

/**
 * Strip ANSI escape codes from text.
 * Useful for copying clean text from terminal output.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

/**
 * Get the last N lines from text.
 */
export function getLastNLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.slice(-n).join('\n');
}
