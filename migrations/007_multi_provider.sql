-- Migration 007: Add multi-provider support
-- Extends session_provider enum with additional AI agent providers
-- Note: ALTER TYPE ADD VALUE cannot be run in a transaction block
-- Execute this file directly with psql, not through a transactional migration runner

-- Add new provider enum values
ALTER TYPE session_provider ADD VALUE IF NOT EXISTS 'gemini_cli';
ALTER TYPE session_provider ADD VALUE IF NOT EXISTS 'opencode';
ALTER TYPE session_provider ADD VALUE IF NOT EXISTS 'cursor';
ALTER TYPE session_provider ADD VALUE IF NOT EXISTS 'aider';
ALTER TYPE session_provider ADD VALUE IF NOT EXISTS 'continue';
