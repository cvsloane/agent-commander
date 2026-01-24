'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type RadioGroupContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name: string;
};

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null);

type RadioGroupProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  className?: string;
  children?: React.ReactNode;
};

export const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  ({ value, onValueChange, disabled, name, className, children }, ref) => {
    const fallbackName = React.useId();
    const groupName = name || `radio-${fallbackName}`;

    return (
      <RadioGroupContext.Provider value={{ value, onValueChange, disabled, name: groupName }}>
        <div ref={ref} role="radiogroup" className={cn('grid gap-2', className)}>
          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }
);

RadioGroup.displayName = 'RadioGroup';

type RadioGroupItemProps = {
  value: string;
  id?: string;
  disabled?: boolean;
  className?: string;
};

export const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ value, id, disabled, className }, ref) => {
    const ctx = React.useContext(RadioGroupContext);
    if (!ctx) {
      throw new Error('RadioGroupItem must be used within a RadioGroup');
    }

    const isChecked = ctx.value === value;
    const isDisabled = ctx.disabled || disabled;

    return (
      <input
        ref={ref}
        type="radio"
        id={id}
        name={ctx.name}
        value={value}
        checked={isChecked}
        disabled={isDisabled}
        onChange={() => ctx.onValueChange?.(value)}
        className={cn(
          'h-4 w-4 rounded-full border border-input text-primary shadow',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      />
    );
  }
);

RadioGroupItem.displayName = 'RadioGroupItem';
