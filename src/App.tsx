/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Lock,
  Unlock,
  Send,
  Users,
  LogOut,
  Volume2,
  VolumeX,
  Search,
  Trash2,
  Reply,
  X,
  Copy,
  Check,
  Smile,
  ShieldCheck,
  ArrowDown,
  Sparkles,
  MessageCircle,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  color?: string;
  system?: boolean;
  replyTo?: {
    id: string;
    sender: string;
    text: string;
  };
  reactions?: Record<string, string[]>;
}

interface ActiveUser {
  name: string;
  color: string;
}

const PRESET_COLORS = [
  '#3b82f6', // blue
  '#ec4899', // pink
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#f43f5e', // rose
  '#6366f1', // indigo
];

const PRESET_MEMBERS = ['Bhavnoor', 'Bella', 'Danish'];
const QUICK_EMOJIS = ['❤️', '😂', '👍', '🔥', '🎉', '😮', '🙌', '💀'];
const CHAT_PASSWORD = '12345';

export default function App() {
  // Authentication & session state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('chat_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState(() => {
    return localStorage.getItem('chat_username') || '';
  });
  const [selectedColor, setSelectedColor] = useState<string>(() => {
    return (
      localStorage.getItem('chat_color') ||
      PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
    );
  });
  const [authError, setAuthError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<ActiveUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('chat_sound') !== 'false';
  });
  const [isConnected, setIsConnected] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Refs
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Play subtle sound on new incoming messages
  const playSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch {
      // AudioContext could be blocked by browser policy prior to user interaction
    }
  }, [soundEnabled]);

  // Scroll to bottom helper
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, []);

  // Monitor scroll position
  const handleScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollBottom(distanceFromBottom > 150);
  };

  // WebSocket Connection
  useEffect(() => {
    if (!isAuthenticated) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      return;
    }

    const currentUserName = nameInput.trim() || 'Anonymous';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let isUnmounted = false;
    let reconnectTimer: NodeJS.Timeout;

    function connect() {
      if (isUnmounted) return;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Authenticate with server
        ws.send(
          JSON.stringify({
            type: 'auth',
            password: sessionStorage.getItem('chat_password') || CHAT_PASSWORD,
            name: currentUserName,
            color: selectedColor,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'init') {
            setMessages(data.messages || []);
            setOnlineUsers(data.users || []);
            setTypingUsers(data.activeTyping || []);
            setTimeout(() => scrollToBottom(false), 50);
          } else if (data.type === 'message') {
            setMessages((prev) => {
              // Avoid duplicate if present
              if (prev.some((m) => m.id === data.message.id)) return prev;
              return [...prev, data.message];
            });
            if (data.message.sender !== currentUserName && !data.message.system) {
              playSound();
            }
            // Auto scroll down if user was already near bottom
            setTimeout(() => scrollToBottom(true), 50);
          } else if (data.type === 'presence') {
            setOnlineUsers(data.users || []);
          } else if (data.type === 'typing') {
            setTypingUsers((data.typingUsers || []).filter((u: string) => u !== currentUserName));
          } else if (data.type === 'reaction_update') {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === data.messageId ? { ...msg, reactions: data.reactions } : msg
              )
            );
          } else if (data.type === 'cleared') {
            setMessages(data.messages || []);
          } else if (data.type === 'auth_error') {
            setIsAuthenticated(false);
            sessionStorage.removeItem('chat_auth');
            setAuthError('Access expired or unauthorized.');
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (!isUnmounted && isAuthenticated) {
          // Reconnect attempt after 2s
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = (err) => {
        console.warn('WebSocket error:', err);
      };
    }

    connect();

    return () => {
      isUnmounted = true;
      clearTimeout(reconnectTimer);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [isAuthenticated, nameInput, selectedColor, playSound, scrollToBottom]);

  // Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const cleanPass = passwordInput.trim();
    const cleanName = nameInput.trim();

    if (!cleanPass) {
      setAuthError('Please enter the password.');
      return;
    }
    if (!cleanName) {
      setAuthError('Please enter your name.');
      return;
    }

    setIsVerifying(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: cleanPass, name: cleanName }),
      });
      const data = await res.json();

      if (data.success) {
        sessionStorage.setItem('chat_auth', 'true');
        sessionStorage.setItem('chat_password', cleanPass);
        localStorage.setItem('chat_username', cleanName);
        localStorage.setItem('chat_color', selectedColor);
        setIsAuthenticated(true);
      } else {
        setAuthError(data.message || 'Incorrect password.');
      }
    } catch {
      if (cleanPass === CHAT_PASSWORD) {
        sessionStorage.setItem('chat_auth', 'true');
        sessionStorage.setItem('chat_password', cleanPass);
        localStorage.setItem('chat_username', cleanName);
        localStorage.setItem('chat_color', selectedColor);
        setIsAuthenticated(true);
      } else {
        setAuthError('Incorrect password. Please try again.');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    if (socketRef.current) {
      socketRef.current.close();
    }
    sessionStorage.removeItem('chat_auth');
    sessionStorage.removeItem('chat_password');
    setIsAuthenticated(false);
    setMessages([]);
    setOnlineUsers([]);
  };

  // Handle Send Message
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const payload = {
      type: 'message',
      text: trimmed,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            sender: replyTarget.sender,
            text: replyTarget.text.slice(0, 100),
          }
        : undefined,
    };

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
    } else {
      // Fallback to HTTP POST
      fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: sessionStorage.getItem('chat_password') || CHAT_PASSWORD,
          sender: nameInput.trim() || 'Anonymous',
          text: trimmed,
          color: selectedColor,
          replyTo: payload.replyTo,
        }),
      }).catch(console.error);
    }

    setInputText('');
    setReplyTarget(null);
    setShowEmojiPicker(false);

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'typing', isTyping: false }));
    }

    inputRef.current?.focus();
  };

  // Typing broadcast with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'typing', isTyping: true }));

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'typing', isTyping: false }));
        }
      }, 2000);
    }
  };

  // Reaction toggling
  const handleToggleReaction = (messageId: string, emoji: string) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'reaction',
          messageId,
          emoji,
        })
      );
    }
  };

  // Clear chat
  const handleClearChat = () => {
    if (!window.confirm('Are you sure you want to clear the group chat for everyone?')) {
      return;
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'clear' }));
    } else {
      fetch('/api/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: sessionStorage.getItem('chat_password') || CHAT_PASSWORD }),
      }).catch(console.error);
    }
  };

  // Copy message text
  const handleCopyText = (msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.text);
    setCopiedMsgId(msg.id);
    setTimeout(() => setCopiedMsgId(null), 1800);
  };

  // Sound toggle
  const toggleSound = () => {
    const nextVal = !soundEnabled;
    setSoundEnabled(nextVal);
    localStorage.setItem('chat_sound', String(nextVal));
  };

  // Filtered messages
  const filteredMessages = searchQuery.trim()
    ? messages.filter((m) =>
        m.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.sender.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  // Format timestamp
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Get user avatar initial
  const getInitial = (name: string) => {
    return name.trim().charAt(0).toUpperCase() || '?';
  };

  // If not authenticated, render Login Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4 selection:bg-indigo-500 selection:text-white">
        <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-7 shadow-2xl backdrop-blur-xl relative overflow-hidden">
          {/* Subtle background glow */}
          <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-pink-500/15 rounded-full blur-3xl pointer-events-none" />

          <div className="relative text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-pink-500 text-white shadow-lg shadow-indigo-500/25 mb-4">
              <Lock className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Private Group Chat</h1>
            <p className="text-slate-400 text-sm mt-1">
              Enter the secret password and your name to join the room.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 relative">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Group Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Enter secret password"
                  autoFocus
                  required
                  className="w-full px-4 py-3 bg-slate-800/90 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono tracking-wider"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Your Name
              </label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Bhavnoor, Bella, Danish..."
                required
                maxLength={30}
                className="w-full px-4 py-3 bg-slate-800/90 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
              />

              {/* Quick suggestion tags */}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[11px] text-slate-400">Quick fill:</span>
                {PRESET_MEMBERS.map((member) => (
                  <button
                    key={member}
                    type="button"
                    onClick={() => setNameInput(member)}
                    className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    {member}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
                Choose Your Avatar Color
              </label>
              <div className="flex items-center gap-2 justify-between px-1 py-1">
                {PRESET_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setSelectedColor(col)}
                    className={`w-7 h-7 rounded-full transition-transform flex items-center justify-center ${
                      selectedColor === col
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110'
                        : 'opacity-70 hover:opacity-100 hover:scale-105'
                    }`}
                    style={{ backgroundColor: col }}
                  >
                    {selectedColor === col && <Check className="w-4 h-4 text-white stroke-[3]" />}
                  </button>
                ))}
              </div>
            </div>

            {authError && (
              <div className="p-3 bg-red-950/60 border border-red-800/60 rounded-xl text-red-300 text-xs flex items-center gap-2 animate-in fade-in duration-200">
                <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifying}
              className="w-full mt-2 py-3.5 px-4 bg-gradient-to-r from-indigo-500 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white font-medium text-sm rounded-xl shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {isVerifying ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Entering...</span>
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4" />
                  <span>Enter Group Chat</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Password protected & real-time synchronized</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Group Chat Screen
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col h-screen overflow-hidden">
      {/* Top Navigation Bar */}
      <header className="h-16 bg-slate-900/90 border-b border-slate-800/80 px-4 flex items-center justify-between shrink-0 backdrop-blur-md z-20">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/20">
              <MessageCircle className="w-5 h-5" />
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${
                isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
              title={isConnected ? 'Connected' : 'Connecting...'}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-slate-100 text-base leading-tight">Squad Chat</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Private
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <button
                onClick={() => setShowMembersModal(true)}
                className="hover:text-slate-200 transition flex items-center gap-1"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{onlineUsers.length} online</span>
              </button>
              <span>•</span>
              <span className="truncate max-w-[120px] text-slate-300 font-medium">
                You: {nameInput}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {/* Search Toggle */}
          <button
            onClick={() => {
              setIsSearchOpen(!isSearchOpen);
              if (isSearchOpen) setSearchQuery('');
            }}
            className={`p-2 rounded-lg transition ${
              isSearchOpen
                ? 'bg-indigo-600/30 text-indigo-300'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Search messages"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Members Toggle */}
          <button
            onClick={() => setShowMembersModal(true)}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
            title="Online members"
          >
            <Users className="w-4 h-4" />
          </button>

          {/* Sound Toggle */}
          <button
            onClick={toggleSound}
            className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
            title={soundEnabled ? 'Mute sound' : 'Unmute sound'}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-slate-300" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {/* Clear Chat */}
          <button
            onClick={handleClearChat}
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          {/* Leave Chat */}
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition"
            title="Leave / Lock chat"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Search Input Dropdown */}
      {isSearchOpen && (
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center gap-2 animate-in slide-in-from-top-2 duration-150 shrink-0">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages or senders..."
            className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              setIsSearchOpen(false);
              setSearchQuery('');
            }}
            className="text-xs text-slate-400 hover:text-white ml-2"
          >
            Close
          </button>
        </div>
      )}

      {/* Main Message Stream */}
      <main
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-3.5 relative"
      >
        {filteredMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-500">
            <Sparkles className="w-8 h-8 text-indigo-400 mb-2 opacity-60" />
            <p className="text-sm font-medium text-slate-400">No messages found</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {searchQuery ? 'Try another keyword' : 'Be the first to say something!'}
            </p>
          </div>
        ) : (
          filteredMessages.map((msg) => {
            const isMe = msg.sender === nameInput.trim();

            if (msg.system) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <div className="text-[11px] text-slate-400 bg-slate-900/90 border border-slate-800/80 px-3.5 py-1 rounded-full shadow-sm">
                    {msg.text}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`group flex items-end gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {/* User Avatar */}
                {!isMe && (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0 shadow-sm"
                    style={{ backgroundColor: msg.color || '#3b82f6' }}
                    title={msg.sender}
                  >
                    {getInitial(msg.sender)}
                  </div>
                )}

                {/* Message Bubble + Actions */}
                <div
                  className={`max-w-[75%] sm:max-w-[65%] flex flex-col ${
                    isMe ? 'items-end' : 'items-start'
                  }`}
                >
                  {/* Sender Name if someone else */}
                  {!isMe && (
                    <span
                      className="text-xs font-medium mb-1 px-1"
                      style={{ color: msg.color || '#93c5fd' }}
                    >
                      {msg.sender}
                    </span>
                  )}

                  {/* Quoted / Reply Preview */}
                  {msg.replyTo && (
                    <div
                      className={`text-xs p-2 mb-1 rounded-lg border-l-2 bg-slate-800/80 text-slate-300 w-full truncate border-indigo-400 ${
                        isMe ? 'text-right' : 'text-left'
                      }`}
                    >
                      <span className="font-semibold text-indigo-300 block text-[10px]">
                        Replying to {msg.replyTo.sender}
                      </span>
                      <span className="truncate block opacity-80">{msg.replyTo.text}</span>
                    </div>
                  )}

                  {/* Text Container */}
                  <div
                    className={`relative px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words shadow-sm ${
                      isMe
                        ? 'bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white rounded-br-none'
                        : 'bg-slate-800/95 text-slate-100 border border-slate-700/60 rounded-bl-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                    <div
                      className={`text-[10px] mt-1 flex items-center gap-1.5 ${
                        isMe ? 'text-indigo-200 justify-end' : 'text-slate-400 justify-start'
                      }`}
                    >
                      <span>{formatTime(msg.timestamp)}</span>
                    </div>
                  </div>

                  {/* Reactions Display */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(msg.reactions).map(([emoji, users]) => {
                        const hasReacted = users.includes(nameInput.trim());
                        return (
                          <button
                            key={emoji}
                            onClick={() => handleToggleReaction(msg.id, emoji)}
                            className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border transition ${
                              hasReacted
                                ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200'
                                : 'bg-slate-800/70 border-slate-700/60 text-slate-300 hover:bg-slate-700'
                            }`}
                            title={users.join(', ')}
                          >
                            <span>{emoji}</span>
                            <span className="text-[10px] font-medium">{users.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Action buttons on hover */}
                  <div
                    className={`opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-1 px-1 ${
                      isMe ? 'flex-row-reverse' : 'flex-row'
                    }`}
                  >
                    {/* Quick Reactions */}
                    <div className="flex items-center bg-slate-900 border border-slate-700 rounded-full px-1 py-0.5 text-xs shadow-md">
                      {['❤️', '😂', '👍'].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => handleToggleReaction(msg.id, emoji)}
                          className="hover:scale-125 px-1 py-0.5 transition"
                          title={`React with ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>

                    {/* Reply button */}
                    <button
                      onClick={() => {
                        setReplyTarget(msg);
                        inputRef.current?.focus();
                      }}
                      className="p-1 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                      title="Reply"
                    >
                      <Reply className="w-3.5 h-3.5" />
                    </button>

                    {/* Copy text */}
                    <button
                      onClick={() => handleCopyText(msg)}
                      className="p-1 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                      title="Copy text"
                    >
                      {copiedMsgId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Floating Scroll to Bottom Button */}
      {showScrollBottom && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-24 right-6 p-2.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl border border-indigo-400/40 transition-all hover:scale-105 active:scale-95 z-20"
          title="Scroll to latest"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-1 text-xs text-indigo-300/90 flex items-center gap-2 bg-slate-900/60 shrink-0">
          <div className="flex gap-1 items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]" />
          </div>
          <span>
            {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
          </span>
        </div>
      )}

      {/* Replying banner */}
      {replyTarget && (
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center justify-between text-xs text-slate-300 shrink-0">
          <div className="flex items-center gap-2 truncate">
            <Reply className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-slate-400">Replying to</span>
            <span className="font-semibold text-indigo-300">{replyTarget.sender}:</span>
            <span className="truncate italic text-slate-400">"{replyTarget.text}"</span>
          </div>
          <button
            onClick={() => setReplyTarget(null)}
            className="p-1 hover:text-white text-slate-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Emoji picker shelf */}
      {showEmojiPicker && (
        <div className="bg-slate-900 border-t border-slate-800 p-2.5 flex items-center gap-2 overflow-x-auto shrink-0">
          <span className="text-xs text-slate-400 shrink-0 mr-1">Quick emojis:</span>
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                setInputText((prev) => prev + emoji);
                inputRef.current?.focus();
              }}
              className="text-lg hover:scale-125 px-1.5 py-0.5 rounded transition"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Message Input Form */}
      <footer className="p-3 bg-slate-900/95 border-t border-slate-800/80 shrink-0">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2 max-w-5xl mx-auto">
          {/* Emoji Toggle */}
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className={`p-2.5 rounded-xl transition ${
              showEmojiPicker
                ? 'bg-indigo-600/30 text-indigo-300'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
            title="Toggle quick emojis"
          >
            <Smile className="w-5 h-5" />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={`Message as ${nameInput || 'You'}... (Enter to send)`}
            className="flex-1 bg-slate-800/90 border border-slate-700/80 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition"
          />

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white shadow-md shadow-indigo-600/25 transition active:scale-95 cursor-pointer"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </footer>

      {/* Online Members Modal */}
      {showMembersModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowMembersModal(false)}
        >
          <div
            className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-slate-100 text-sm">Active Members in Chat</h3>
              </div>
              <button
                onClick={() => setShowMembersModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {onlineUsers.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No members online right now</p>
              ) : (
                onlineUsers.map((user, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/50 border border-slate-800"
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shadow-sm"
                        style={{ backgroundColor: user.color || '#3b82f6' }}
                      >
                        {getInitial(user.name)}
                      </div>
                      <span className="text-sm font-medium text-slate-200">{user.name}</span>
                      {user.name === nameInput.trim() && (
                        <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full font-medium border border-indigo-500/20">
                          You
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Online</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 text-center">
              <p className="text-[11px] text-slate-400">
                Anyone with the secret password can enter their name and chat here instantly!
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
