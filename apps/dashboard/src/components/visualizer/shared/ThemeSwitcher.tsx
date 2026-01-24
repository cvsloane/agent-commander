'use client';

import { useState } from 'react';
import { useVisualizerThemeStore, type VisualizerTheme } from '@/stores/visualizerTheme';
import { Palette, ChevronDown, Check } from 'lucide-react';

interface ThemeOption {
  id: VisualizerTheme;
  name: string;
  description: string;
  icon: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'botspace',
    name: 'Botspace',
    description: 'Orbital station with floating platforms',
    icon: 'o',
  },
  {
    id: 'civilization',
    name: 'Empire View',
    description: 'Strategic map with territories',
    icon: '#',
  },
  {
    id: 'bridge-control',
    name: 'Bridge Control',
    description: 'LCARS-style control panel',
    icon: '=',
  },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useVisualizerThemeStore();
  const [isOpen, setIsOpen] = useState(false);

  const currentTheme = THEME_OPTIONS.find((t) => t.id === theme) || THEME_OPTIONS[0];

  const handleThemeSelect = (newTheme: VisualizerTheme) => {
    setTheme(newTheme);
    setIsOpen(false);
  };

  return (
    <div className="theme-switcher">
      <button
        className="theme-switcher-trigger"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Palette className="theme-switcher-icon" />
        <span className="theme-switcher-label">{currentTheme.name}</span>
        <ChevronDown className={`theme-switcher-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="theme-switcher-backdrop"
            onClick={() => setIsOpen(false)}
          />
          <div className="theme-switcher-dropdown" role="listbox">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.id}
                className={`theme-switcher-option ${option.id === theme ? 'selected' : ''}`}
                onClick={() => handleThemeSelect(option.id)}
                role="option"
                aria-selected={option.id === theme}
              >
                <span className="theme-option-icon">{option.icon}</span>
                <div className="theme-option-content">
                  <span className="theme-option-name">{option.name}</span>
                  <span className="theme-option-description">{option.description}</span>
                </div>
                {option.id === theme && (
                  <Check className="theme-option-check" />
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <style jsx>{`
        .theme-switcher {
          position: relative;
          z-index: var(--viz-z-overlay, 10);
        }

        .theme-switcher-trigger {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--viz-bg-surface, rgba(20, 20, 25, 0.95));
          border: 1px solid var(--viz-border-subtle, rgba(255, 255, 255, 0.1));
          border-radius: var(--viz-border-radius, 8px);
          color: var(--viz-text-secondary, rgba(255, 255, 255, 0.7));
          font-size: 13px;
          cursor: pointer;
          transition: all 150ms;
          backdrop-filter: blur(8px);
        }

        .theme-switcher-trigger:hover {
          background: var(--viz-bg-tertiary, #1a1a1a);
          border-color: var(--viz-border-default, rgba(255, 255, 255, 0.15));
          color: var(--viz-text-primary, #fff);
        }

        .theme-switcher-icon {
          width: 16px;
          height: 16px;
          color: var(--viz-accent-primary, #a78bfa);
        }

        .theme-switcher-label {
          font-weight: 500;
        }

        .theme-switcher-chevron {
          width: 14px;
          height: 14px;
          transition: transform 150ms;
        }

        .theme-switcher-chevron.open {
          transform: rotate(180deg);
        }

        .theme-switcher-backdrop {
          position: fixed;
          inset: 0;
          z-index: 1;
        }

        .theme-switcher-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          min-width: 240px;
          background: var(--viz-bg-surface, rgba(20, 20, 25, 0.98));
          border: 1px solid var(--viz-border-subtle, rgba(255, 255, 255, 0.1));
          border-radius: var(--viz-border-radius, 8px);
          padding: 4px;
          z-index: 2;
          backdrop-filter: blur(12px);
          box-shadow: var(--viz-shadow-lg, 0 10px 15px rgba(0, 0, 0, 0.5));
        }

        .theme-switcher-option {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: background 150ms;
          text-align: left;
        }

        .theme-switcher-option:hover {
          background: var(--viz-accent-subtle, rgba(167, 139, 250, 0.15));
        }

        .theme-switcher-option.selected {
          background: var(--viz-accent-subtle, rgba(167, 139, 250, 0.2));
        }

        .theme-option-icon {
          font-size: 20px;
          flex-shrink: 0;
        }

        .theme-option-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .theme-option-name {
          color: var(--viz-text-primary, #fff);
          font-size: 13px;
          font-weight: 500;
        }

        .theme-option-description {
          color: var(--viz-text-muted, rgba(255, 255, 255, 0.5));
          font-size: 11px;
        }

        .theme-option-check {
          width: 16px;
          height: 16px;
          color: var(--viz-accent-primary, #a78bfa);
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
