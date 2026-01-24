'use client';

import { useState, useCallback, useEffect } from 'react';
import { Mic, MicOff, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { cn } from '@/lib/utils';

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Voice input button with microphone control and transcript display.
 * Use Ctrl+M to toggle listening.
 */
export function VoiceInputButton({
  onTranscript,
  disabled = false,
  className,
}: VoiceInputButtonProps) {
  const [showIndicator, setShowIndicator] = useState(false);

  const handleFinalTranscript = useCallback(
    (text: string) => {
      onTranscript(text);
    },
    [onTranscript]
  );

  const {
    isListening,
    transcript,
    interimTranscript,
    isConnecting,
    error,
    startListening,
    stopListening,
    clearTranscript,
  } = useVoiceInput({
    onFinalTranscript: handleFinalTranscript,
  });

  // Show indicator when listening
  useEffect(() => {
    setShowIndicator(isListening || isConnecting);
  }, [isListening, isConnecting]);

  // Keyboard shortcut: Ctrl+M to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        if (isListening) {
          stopListening();
        } else if (!disabled) {
          startListening();
        }
      } else if (e.key === 'Escape' && isListening) {
        stopListening();
        clearTranscript();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isListening, disabled, startListening, stopListening, clearTranscript]);

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleCancel = () => {
    stopListening();
    clearTranscript();
  };

  return (
    <div className={cn('relative inline-flex items-center gap-2', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isListening ? 'destructive' : 'outline'}
            size="icon"
            onClick={handleClick}
            disabled={disabled || isConnecting}
            className={cn(
              'relative',
              isListening && 'animate-pulse'
            )}
          >
            {isConnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isListening ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {isListening && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{isListening ? 'Stop listening (Ctrl+M or Esc)' : 'Start voice input (Ctrl+M)'}</p>
        </TooltipContent>
      </Tooltip>

      {/* Listening indicator with transcript */}
      {showIndicator && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm max-w-[300px]">
          {isConnecting ? (
            <span className="text-muted-foreground">Connecting...</span>
          ) : (
            <>
              <span className="text-red-500 font-medium shrink-0">Listening</span>
              <span className="truncate text-muted-foreground">
                {interimTranscript || transcript || '...'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                onClick={handleCancel}
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}

      {/* Error display */}
      {error && !isListening && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
