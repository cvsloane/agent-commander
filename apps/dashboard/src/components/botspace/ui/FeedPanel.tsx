'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SessionWithSnapshot } from '@agent-command/schema';
import { SLASH_COMMANDS, type SlashCommand } from '@/lib/workshop/slashCommands';
import type { WorkshopEvent } from '@/lib/workshop/types';
import { getToolContext } from '@/lib/workshop/toolContext';
import { getToolIcon } from '@/lib/workshop/toolIcons';
import type { SessionVizState } from '../scene/OrbitScene';

interface FeedPanelProps {
  sessions: SessionWithSnapshot[];
  sessionStates: Record<string, SessionVizState>;
  selectedSessionId: string | null;
  events: WorkshopEvent[];
  sessionColors: Map<string, string>;
  onSelectSession: (id: string | null) => void;
  onSendPrompt: (prompt: string, sendToTmux: boolean) => void;
  onInterrupt: () => void;
  onToggleNewSession: () => void;
  sendToTmux: boolean;
  setSendToTmux: (value: boolean) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  promptStatus: { type: 'idle' | 'success' | 'error'; message?: string };
  voiceTranscript: { visible: boolean; text: string; interim: boolean };
  attentionCount: number;
}

interface FeedItem {
  id: string;
  sessionId: string;
  type: 'prompt' | 'thinking' | 'tool' | 'response' | 'notification';
  timestamp: number;
  title: string;
  content?: string;
  toolName?: string;
  toolContext?: string | null;
  success?: boolean;
  duration?: number;
}

export function FeedPanel({
  sessions,
  sessionStates,
  selectedSessionId,
  events,
  sessionColors,
  onSelectSession,
  onSendPrompt,
  onInterrupt,
  onToggleNewSession,
  sendToTmux,
  setSendToTmux,
  prompt,
  setPrompt,
  promptStatus,
  voiceTranscript,
  attentionCount,
}: FeedPanelProps) {
  const [showScrollButton, setShowScrollButton] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [slashIndex, setSlashIndex] = useState(0);

  const updateSlashCommands = (value: string, cursorPos: number) => {
    const beforeCursor = value.slice(0, cursorPos);
    const lineStart = beforeCursor.lastIndexOf('\n') + 1;
    const currentLine = beforeCursor.slice(lineStart);
    if (currentLine.startsWith('/')) {
      const query = currentLine.toLowerCase();
      const filtered = SLASH_COMMANDS.filter((cmd) =>
        cmd.command.toLowerCase().startsWith(query)
      );
      setSlashCommands(filtered);
      setSlashIndex(0);
      setSlashOpen(filtered.length > 0);
      return;
    }
    setSlashOpen(false);
    setSlashCommands([]);
  };

  const selectSlashCommand = (command: string) => {
    setPrompt(`${command} `);
    setSlashOpen(false);
    setSlashCommands([]);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
        el.focus();
      }
    });
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement === el) {
      updateSlashCommands(prompt, el.selectionStart ?? prompt.length);
    }
  }, [prompt]);

  const items = useMemo(() => {
    const toolMap = new Map<string, { pre?: WorkshopEvent; post?: WorkshopEvent }>();
    const feed: FeedItem[] = [];

    const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const lastPromptBySession = new Map<string, WorkshopEvent>();
    const lastStopBySession = new Map<string, WorkshopEvent>();

    for (const event of ordered) {
      if (event.type === 'pre_tool_use' || event.type === 'post_tool_use') {
        const key = event.type === 'pre_tool_use'
          ? event.toolUseId || event.id
          : event.toolUseId || event.id;
        const entry = toolMap.get(key) || {};
        if (event.type === 'pre_tool_use') {
          entry.pre = event;
        } else {
          entry.post = event;
        }
        toolMap.set(key, entry);
      }

      if (event.type === 'user_prompt_submit') {
        feed.push({
          id: event.id,
          sessionId: event.sessionId,
          type: 'prompt',
          timestamp: event.timestamp,
          title: 'You',
          content: event.prompt,
        });
        lastPromptBySession.set(event.sessionId, event);
      }

      if (event.type === 'notification') {
        feed.push({
          id: event.id,
          sessionId: event.sessionId,
          type: 'notification',
          timestamp: event.timestamp,
          title: event.notificationType || 'Notification',
          content: event.message,
        });
      }

      if (event.type === 'stop') {
        lastStopBySession.set(event.sessionId, event);
        if (event.response) {
          feed.push({
            id: event.id,
            sessionId: event.sessionId,
            type: 'response',
            timestamp: event.timestamp,
            title: 'Claude',
            content: event.response,
          });
        }
      }
    }

    for (const [id, entry] of Array.from(toolMap.entries())) {
      const pre = entry.pre as any;
      if (!pre) continue;
      const post = entry.post as any;
      const toolContext = getToolContext(pre.tool, pre.toolInput as Record<string, unknown> | undefined, pre.cwd);
      const duration = post?.duration ?? (post ? post.timestamp - pre.timestamp : undefined);
      feed.push({
        id,
        sessionId: pre.sessionId,
        type: 'tool',
        timestamp: pre.timestamp,
        title: pre.tool,
        toolName: pre.tool,
        toolContext,
        success: post?.success,
        duration,
      });
    }

    for (const session of sessions) {
      const state = sessionStates[session.id];
      if (!state) continue;
      if (state.status !== 'thinking' && state.status !== 'working') continue;
      const lastPrompt = lastPromptBySession.get(session.id);
      const lastStop = lastStopBySession.get(session.id);
      if (!lastPrompt) continue;
      if (lastStop && lastStop.timestamp > lastPrompt.timestamp) continue;
      feed.push({
        id: `${session.id}-thinking`,
        sessionId: session.id,
        type: 'thinking',
        timestamp: lastPrompt.timestamp + 1,
        title: 'Claude is thinking...',
      });
    }

    return feed.sort((a, b) => a.timestamp - b.timestamp);
  }, [events, sessionStates, sessions]);

  const sessionsDisplay = useMemo(() => {
    return sessions.map((session, index) => {
      const state = sessionStates[session.id];
      const attention =
        session.status === 'WAITING_FOR_INPUT' ||
        session.status === 'WAITING_FOR_APPROVAL' ||
        session.status === 'ERROR';
      const statusClass =
        session.status === 'ERROR' || session.status === 'DONE'
          ? 'offline'
          : session.status === 'WAITING_FOR_INPUT' || session.status === 'WAITING_FOR_APPROVAL'
            ? 'waiting'
            : state?.status === 'working' || state?.status === 'thinking'
              ? 'working'
              : 'idle';
      let detail = session.cwd || '';
      if (attention) {
        detail = 'Needs attention';
      } else if (session.status === 'WAITING_FOR_APPROVAL') {
        detail = `Waiting for permission`;
      } else if (state?.currentTool) {
        detail = `Using ${state.currentTool}`;
      }
      return {
        session,
        index,
        attention,
        statusClass,
        detail,
      };
    });
  }, [sessions, sessionStates]);

  const allSessionsDetail = useMemo(() => {
    if (sessionsDisplay.length === 0) {
      return 'Click "+ New" to start';
    }
    const workingCount = sessionsDisplay.filter((item) => item.statusClass === 'working').length;
    if (workingCount > 0) {
      return `${sessionsDisplay.length} orbit${sessionsDisplay.length > 1 ? 's' : ''}, ${workingCount} active`;
    }
    return `${sessionsDisplay.length} orbit${sessionsDisplay.length > 1 ? 's' : ''}`;
  }, [sessionsDisplay]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setShowScrollButton(!atBottom);
    if (atBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [items]);

  const handleScroll = () => {
    const container = listRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setShowScrollButton(!atBottom);
  };

  const scrollToBottom = () => {
    const container = listRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  };

  useEffect(() => {
    scrollToBottom();
  }, [selectedSessionId]);

  const handleSubmit = () => {
    const text = prompt.trim();
    if (!text || !selectedSessionId) return;
    onSendPrompt(text, sendToTmux);
    setPrompt('');
  };

  return (
    <div id="feed-panel">
      <div id="feed-header">
        <div id="feed-header-left">
          <h2>
            Botspace <span className="muted">(orbital)</span>
          </h2>
          <button id="new-session-btn" type="button" onClick={onToggleNewSession}>
            + New
          </button>
        </div>
        <div className="feed-header-right">
          <a className="header-btn" href="/" title="Back to console">
            Console
          </a>
          <span id="attention-badge" className={`attention-badge ${attentionCount > 0 ? '' : 'hidden'}`}>
            {attentionCount}
          </span>
          <button id="about-btn" className="feed-about-btn" type="button">
            ?
          </button>
        </div>
      </div>

      <div id="sessions-panel">
        <div id="sessions-list">
          <div
            className={`session-item all-sessions ${selectedSessionId === null ? 'active' : ''}`}
            onClick={() => onSelectSession(null)}
          >
            <div className="session-hotkey">0</div>
            <div className="session-icon">O</div>
            <div className="session-info">
              <div className="session-name">All Orbits</div>
              <div className="session-detail" id="all-sessions-count">
                {allSessionsDetail}
              </div>
            </div>
          </div>
          <div id="managed-sessions">
            {sessionsDisplay.map(({ session, index, attention, statusClass, detail }) => (
              <div
                key={session.id}
                className={`session-item ${selectedSessionId === session.id ? 'active' : ''} ${attention ? 'needs-attention' : ''}`}
                onClick={() => onSelectSession(session.id)}
              >
                <div className="session-hotkey">{index < 6 ? index + 1 : ''}</div>
                <div className="session-icon">o</div>
                <div className={`session-status ${statusClass}`} />
                <div className="session-info">
                  <div className="session-name">{session.title || session.cwd?.split('/').pop() || 'Orbit'}</div>
                  <div className={`session-detail ${attention ? 'attention' : ''}`}>{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div id="activity-feed-wrapper">
        <div id="activity-feed" ref={listRef} onScroll={handleScroll}>
          {items.length === 0 ? (
            <div id="feed-empty">
              <div id="feed-empty-icon">o</div>
              <h3>Waiting for activity</h3>
              <p>Claude Code hook events power the flow. If this stays empty, hooks are likely not configured on the agent host.</p>
            </div>
          ) : (
            items.map((item) => {
              const color = sessionColors.get(item.sessionId);
              const borderStyle =
                selectedSessionId === null && color
                  ? { borderLeft: `3px solid ${color}` }
                  : undefined;
              const sessionName = sessions.find((session) => session.id === item.sessionId)?.title ||
                sessions.find((session) => session.id === item.sessionId)?.cwd?.split('/').pop() ||
                'Orbit';
              const titleSuffix = selectedSessionId === null ? ` - ${sessionName}` : '';
              const timeLabel = new Date(item.timestamp).toLocaleTimeString();
              if (item.type === 'thinking') {
                return (
                  <div key={item.id} className="feed-item thinking-indicator" style={borderStyle}>
                    <div className="feed-item-header">
                      <div className="feed-item-icon thinking-icon">...</div>
                      <div className="feed-item-title">{`Claude is thinking${titleSuffix}`}</div>
                      <div className="thinking-dots"><span>.</span><span>.</span><span>.</span></div>
                    </div>
                  </div>
                );
              }
              if (item.type === 'prompt') {
                return (
                  <div key={item.id} className="feed-item user-prompt" style={borderStyle}>
                    <div className="feed-item-header">
                      <div className="feed-item-icon">&gt;</div>
                      <div className="feed-item-title">{`You${titleSuffix}`}</div>
                      <div className="feed-item-time">{timeLabel}</div>
                    </div>
                    <div className="feed-item-content prompt-text">{item.content}</div>
                  </div>
                );
              }
              if (item.type === 'response') {
                return (
                  <div key={item.id} className="feed-item assistant-response" style={borderStyle}>
                    <div className="feed-item-header">
                      <div className="feed-item-icon">o</div>
                      <div className="feed-item-title">{`Claude${titleSuffix}`}</div>
                      <div className="feed-item-time">{timeLabel}</div>
                    </div>
                    <div className="feed-item-content assistant-text">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content || ''}</ReactMarkdown>
                    </div>
                  </div>
                );
              }
              if (item.type === 'tool') {
                const statusClass =
                  item.success === undefined
                    ? 'tool-pending'
                    : item.success
                      ? 'tool-success'
                      : 'tool-fail';
                return (
                  <div key={item.id} className={`feed-item tool-use compact ${statusClass}`} style={borderStyle}>
                    <div className="feed-item-header">
                      <div className="feed-item-icon">{getToolIcon(item.toolName || '')}</div>
                      <div className="feed-item-title">{item.toolName}</div>
                      <div className="feed-item-time">{timeLabel}</div>
                      {item.duration ? (
                        <div className="feed-item-duration">{Math.round(item.duration)}ms</div>
                      ) : null}
                    </div>
                    {item.toolContext && (
                      <div className="feed-item-content">{item.toolContext}</div>
                    )}
                  </div>
                );
              }
              return (
                <div key={item.id} className="feed-item" style={borderStyle}>
                  <div className="feed-item-header">
                    <div className="feed-item-icon">!</div>
                    <div className="feed-item-title">{item.title}</div>
                    <div className="feed-item-time">{timeLabel}</div>
                  </div>
                  <div className="feed-item-content">{item.content}</div>
                </div>
              );
            })
          )}
        </div>
        <button
          id="feed-scroll-bottom"
          className={showScrollButton ? 'visible' : ''}
          onClick={scrollToBottom}
          type="button"
        >
          Jump to latest
        </button>
      </div>

      <div id="prompt-container">
        <div
          id="voice-transcript"
          className={`${voiceTranscript.visible ? 'visible' : ''} ${voiceTranscript.interim ? 'interim' : ''}`}
        >
          <div className="transcript-label"><span className="recording-dot"></span> Listening...</div>
          <div id="voice-transcript-text">{voiceTranscript.text}</div>
        </div>
        <form
          id="prompt-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <div className="input-wrapper">
            <textarea
              id="prompt-input"
              ref={inputRef}
              value={prompt}
              onChange={(e) => {
                const next = e.target.value;
                setPrompt(next);
                updateSlashCommands(next, e.target.selectionStart ?? next.length);
              }}
              placeholder={selectedSessionId ? 'Prompt...' : 'Select an orbit'}
              rows={1}
              onKeyDown={(e) => {
                if (slashOpen) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex((prev) => (prev + 1) % slashCommands.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex((prev) => (prev - 1 + slashCommands.length) % slashCommands.length);
                    return;
                  }
                  if (e.key === 'Tab' || e.key === 'Enter') {
                    e.preventDefault();
                    const cmd = slashCommands[slashIndex];
                    if (cmd) {
                      selectSlashCommand(cmd.command);
                    }
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSlashOpen(false);
                    setSlashCommands([]);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.defaultPrevented) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              onBlur={() => {
                setTimeout(() => {
                  setSlashOpen(false);
                }, 150);
              }}
              onClick={(e) => {
                const target = e.currentTarget;
                updateSlashCommands(target.value, target.selectionStart ?? target.value.length);
              }}
            />
            {slashOpen && slashCommands.length > 0 && (
              <div className="slash-commands-dropdown">
                {slashCommands.map((cmd, idx) => (
                  <div
                    key={cmd.command}
                    className={`slash-command-item${idx === slashIndex ? ' selected' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSlashCommand(cmd.command);
                    }}
                  >
                    <span className="slash-command-name">{cmd.command}</span>
                    <span className="slash-command-desc">{cmd.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" id="prompt-submit" disabled={!selectedSessionId}>
            Send
          </button>
          <button type="button" id="prompt-cancel" onClick={onInterrupt}>
            Stop
          </button>
        </form>
        <div id="prompt-options">
          <label className="send-toggle">
            <input
              type="checkbox"
              checked={sendToTmux}
              onChange={(e) => setSendToTmux(e.target.checked)}
            />
            Send to tmux
          </label>
          <span id="prompt-target">
            {selectedSessionId && sessionColors.get(selectedSessionId) && (
              <span
                className="target-dot"
                style={{ background: sessionColors.get(selectedSessionId) }}
              />
            )}
            {selectedSessionId
              ? sessions.find((session) => session.id === selectedSessionId)?.title ||
                sessions.find((session) => session.id === selectedSessionId)?.cwd?.split('/').pop() ||
                'Orbit'
              : 'All Orbits'}
          </span>
          <span
            id="prompt-status"
            className={promptStatus.type === 'success' ? 'success' : promptStatus.type === 'error' ? 'error' : ''}
          >
            {promptStatus.message || ''}
          </span>
        </div>
      </div>
    </div>
  );
}
