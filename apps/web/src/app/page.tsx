"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  CheckCircle2,
  Globe2,
  Hash,
  Languages,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { API_URL, ApiError, apiRequest } from "@/lib/api";

interface User {
  id: string;
  email: string;
  username: string;
  role: string;
}

interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
}

interface Room {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: "PUBLIC";
  language: string;
  category: string | null;
  maxUsers: number;
  memberCount: number;
  createdAt: string;
}

interface ChatMessage {
  id: string;
  roomId: string;
  content: string;
  type: "TEXT";
  replyTo: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  sender: {
    id: string;
    username: string;
    avatar: string | null;
  };
}

interface MessagePage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

interface SocketAck<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const STORAGE_KEY = "zestchat.session";

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const initials = (name: string) => name.slice(0, 2).toUpperCase();

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [language, setLanguage] = useState("");
  const [category, setCategory] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState("");
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const selectedRoomRef = useRef<Room | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          setSession(JSON.parse(stored) as Session);
        } catch {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
      setSessionReady(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const persistSession = useCallback((value: Session | null) => {
    setSession(value);
    if (value) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } else {
      setSocketConnected(false);
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    if (!session?.refreshToken) throw new ApiError("Session expired", 401);

    const tokens = await apiRequest<{
      accessToken: string;
      refreshToken: string;
    }>("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: session.refreshToken },
    });
    const refreshed = { ...session, ...tokens };
    persistSession(refreshed);
    return refreshed.accessToken;
  }, [persistSession, session]);

  const authenticatedRequest = useCallback(
    async <T,>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}) => {
      if (!session) throw new ApiError("Sign in to continue", 401);

      try {
        return await apiRequest<T>(path, {
          ...options,
          token: session.accessToken,
        });
      } catch (requestError) {
        if (!(requestError instanceof ApiError) || requestError.status !== 401) {
          throw requestError;
        }

        try {
          const accessToken = await refreshSession();
          return await apiRequest<T>(path, { ...options, token: accessToken });
        } catch (refreshError) {
          persistSession(null);
          throw refreshError;
        }
      }
    },
    [persistSession, refreshSession, session]
  );

  const loadRooms = useCallback(async () => {
    setRoomsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (language.trim()) params.set("language", language.trim());
    if (category.trim()) params.set("category", category.trim());

    try {
      const data = await apiRequest<Room[]>(
        `/api/v1/chat/rooms${params.size ? `?${params}` : ""}`
      );
      setRooms(data);
      if (selectedRoom && !data.some((room) => room.id === selectedRoom.id)) {
        setSelectedRoom(null);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to load rooms"
      );
    } finally {
      setRoomsLoading(false);
    }
  }, [category, language, selectedRoom]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRooms(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    if (!session) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io(API_URL, {
      auth: { token: session.accessToken },
      transports: ["websocket"],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketConnected(true);
      const room = selectedRoomRef.current;
      if (room) socket.emit("room:join", { roomId: room.id });
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", (socketError) => {
      setSocketConnected(false);
      setError(socketError.message);
    });
    socket.on("message:new", (message: ChatMessage) => {
      if (message.roomId !== selectedRoomRef.current?.id) return;
      setMessages((current) =>
        current.some(({ id }) => id === message.id)
          ? current
          : [...current, message]
      );
    });
    socket.on(
      "operation:error",
      ({ error: socketError }: { error: string }) => setError(socketError)
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const loadHistory = useCallback(
    async (roomId: string) => {
      setHistoryLoading(true);
      setMessages([]);
      setNextCursor(null);
      try {
        const page = await authenticatedRequest<MessagePage>(
          `/api/v1/chat/rooms/${roomId}/messages?limit=50`
        );
        setMessages(page.messages);
        setNextCursor(page.nextCursor);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load messages"
        );
      } finally {
        setHistoryLoading(false);
      }
    },
    [authenticatedRequest]
  );

  const joinRoom = async (room: Room) => {
    if (!session) {
      setSelectedRoom(room);
      setNotice("Create an account or sign in to join this room.");
      return;
    }

    setJoiningRoomId(room.id);
    setError(null);
    try {
      await authenticatedRequest<{ roomId: string }>(
        `/api/v1/chat/rooms/${room.id}/join`,
        { method: "POST" }
      );
      if (selectedRoom && selectedRoom.id !== room.id) {
        socketRef.current?.emit("room:leave", { roomId: selectedRoom.id });
      }
      setSelectedRoom(room);
      socketRef.current?.emit(
        "room:join",
        { roomId: room.id },
        (response: SocketAck<{ roomId: string }>) => {
          if (!response.success) setError(response.error || "Unable to connect");
        }
      );
      await loadHistory(room.id);
      setNotice(`You joined ${room.name}.`);
      void loadRooms();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to join room"
      );
    } finally {
      setJoiningRoomId(null);
    }
  };

  const leaveRoom = async () => {
    if (!selectedRoom || !session) return;

    try {
      await authenticatedRequest<{ roomId: string }>(
        `/api/v1/chat/rooms/${selectedRoom.id}/leave`,
        { method: "POST" }
      );
      socketRef.current?.emit("room:leave", { roomId: selectedRoom.id });
      setNotice(`You left ${selectedRoom.name}.`);
      setSelectedRoom(null);
      setMessages([]);
      setNextCursor(null);
      void loadRooms();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to leave room"
      );
    }
  };

  const loadOlder = async () => {
    if (!selectedRoom || !nextCursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const page = await authenticatedRequest<MessagePage>(
        `/api/v1/chat/rooms/${selectedRoom.id}/messages?limit=50&before=${encodeURIComponent(
          nextCursor
        )}`
      );
      setMessages((current) => [...page.messages, ...current]);
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load older messages"
      );
    } finally {
      setOlderLoading(false);
    }
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !selectedRoom || !socketRef.current) return;

    setSending(true);
    setError(null);
    socketRef.current.emit(
      "message:send",
      { roomId: selectedRoom.id, content },
      (response: SocketAck<{ message: ChatMessage }>) => {
        setSending(false);
        if (!response.success) {
          setError(response.error || "Unable to send message");
          return;
        }
        setDraft("");
      }
    );
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setAuthLoading(true);
    setError(null);

    try {
      const data = await apiRequest<Session>(
        `/api/v1/auth/${authMode}`,
        {
          method: "POST",
          body:
            authMode === "register"
              ? { email, username, password }
              : { email, password },
        }
      );
      persistSession(data);
      setPassword("");
      setNotice(
        authMode === "register"
          ? `Welcome to ZestChat, ${data.user.username}.`
          : `Welcome back, ${data.user.username}.`
      );
      if (selectedRoom) await joinRoomWithSession(selectedRoom, data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Authentication failed"
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const joinRoomWithSession = async (room: Room, activeSession: Session) => {
    try {
      await apiRequest<{ roomId: string }>(
        `/api/v1/chat/rooms/${room.id}/join`,
        { method: "POST", token: activeSession.accessToken }
      );
      const page = await apiRequest<MessagePage>(
        `/api/v1/chat/rooms/${room.id}/messages?limit=50`,
        { token: activeSession.accessToken }
      );
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to join room"
      );
    }
  };

  const logout = async () => {
    if (session) {
      await apiRequest("/api/v1/auth/logout", {
        method: "POST",
        token: session.accessToken,
      }).catch(() => undefined);
    }
    persistSession(null);
    setSelectedRoom(null);
    setMessages([]);
    setNotice("You are signed out.");
  };

  const roomLanguages = useMemo(
    () => Array.from(new Set(rooms.map((room) => room.language))).sort(),
    [rooms]
  );

  if (!sessionReady) {
    return (
      <main className="loading-screen">
        <Loader2 className="animate-spin" aria-hidden="true" />
        <span>Opening ZestChat...</span>
      </main>
    );
  }

  return (
    <main className="app-canvas">
      <div className="ink-orbit ink-orbit-one" />
      <div className="ink-orbit ink-orbit-two" />

      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            Z
          </div>
          <div>
            <p className="eyebrow">Public rooms, real people</p>
            <h1>ZestChat</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <div className={`connection-pill ${socketConnected ? "is-live" : ""}`}>
            <span />
            {session
              ? socketConnected
                ? "Live"
                : "Reconnecting"
              : "Browse mode"}
          </div>
          {session && (
            <>
              <div className="user-chip">
                <span>{initials(session.user.username)}</span>
                <strong>{session.user.username}</strong>
              </div>
              <button className="icon-button" onClick={logout} title="Sign out">
                <LogOut size={18} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flag-ribbon" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>

      {(notice || error) && (
        <div className={`toast-strip ${error ? "is-error" : ""}`}>
          {error ? <X size={18} /> : <CheckCircle2 size={18} />}
          <span>{error || notice}</span>
          <button
            onClick={() => {
              setError(null);
              setNotice(null);
            }}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="chat-shell">
        <aside className="room-rail">
          <div className="rail-heading">
            <div>
              <p className="eyebrow">Find your corner</p>
              <h2>Public rooms</h2>
            </div>
            <button
              className="icon-button soft"
              onClick={() => void loadRooms()}
              aria-label="Refresh rooms"
            >
              <RefreshCw size={17} className={roomsLoading ? "animate-spin" : ""} />
            </button>
          </div>

          <form
            className="filter-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void loadRooms();
            }}
          >
            <label>
              <Languages size={16} />
              <input
                list="room-languages"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                placeholder="Language, e.g. en"
              />
              <datalist id="room-languages">
                {roomLanguages.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </label>
            <label>
              <Search size={16} />
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="Category"
              />
            </label>
            <button className="filter-button" type="submit">
              Explore
            </button>
          </form>

          <div className="room-list">
            {roomsLoading ? (
              <div className="rail-state">
                <Loader2 className="animate-spin" />
                <span>Gathering rooms...</span>
              </div>
            ) : rooms.length === 0 ? (
              <div className="rail-state">
                <Globe2 />
                <strong>No public rooms yet</strong>
                <span>Try clearing the filters.</span>
              </div>
            ) : (
              rooms.map((room, index) => (
                <button
                  key={room.id}
                  className={`room-card ${
                    selectedRoom?.id === room.id ? "is-active" : ""
                  }`}
                  onClick={() => void joinRoom(room)}
                  style={{ "--room-index": index } as React.CSSProperties}
                >
                  <div className="room-card-topline">
                    <span className="room-symbol">
                      <Hash size={17} />
                    </span>
                    <span className="room-language">{room.language}</span>
                  </div>
                  <strong>{room.name}</strong>
                  <p>{room.description || "A public place to meet and talk."}</p>
                  <div className="room-meta">
                    <span>
                      <Users size={14} />
                      {room.memberCount}/{room.maxUsers}
                    </span>
                    <span>{room.category || "General"}</span>
                  </div>
                  {joiningRoomId === room.id && (
                    <Loader2 className="room-loader animate-spin" size={18} />
                  )}
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="conversation-panel">
          {selectedRoom && session ? (
            <>
              <header className="conversation-header">
                <div>
                  <p className="eyebrow">
                    <Globe2 size={14} /> {selectedRoom.language} public room
                  </p>
                  <h2>{selectedRoom.name}</h2>
                  <p>
                    {selectedRoom.description ||
                      "Be curious, be kind, and make space for every voice."}
                  </p>
                </div>
                <button className="leave-button" onClick={() => void leaveRoom()}>
                  Leave room
                </button>
              </header>

              <div className="message-stage">
                {nextCursor && (
                  <button
                    className="older-button"
                    onClick={() => void loadOlder()}
                    disabled={olderLoading}
                  >
                    {olderLoading ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <ArrowDown size={15} />
                    )}
                    Load earlier messages
                  </button>
                )}

                {historyLoading ? (
                  <div className="conversation-state">
                    <Loader2 className="animate-spin" />
                    <span>Opening the conversation...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="conversation-state welcome-state">
                    <div className="spark-cluster">
                      <Sparkles />
                    </div>
                    <h3>Start with something real.</h3>
                    <p>
                      Ask a question, share a small win, or simply say hello.
                    </p>
                  </div>
                ) : (
                  <div className="message-list">
                    {messages.map((message) => {
                      const mine = message.sender.id === session.user.id;
                      return (
                        <article
                          className={`message-row ${mine ? "is-mine" : ""}`}
                          key={message.id}
                        >
                          {!mine && (
                            <div className="message-avatar">
                              {initials(message.sender.username)}
                            </div>
                          )}
                          <div className="message-content">
                            <div className="message-byline">
                              <strong>{mine ? "You" : message.sender.username}</strong>
                              <time>{formatTime(message.createdAt)}</time>
                            </div>
                            <p>{message.content}</p>
                          </div>
                        </article>
                      );
                    })}
                    <div ref={messageEndRef} />
                  </div>
                )}
              </div>

              <form className="composer" onSubmit={sendMessage}>
                <div>
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    maxLength={4096}
                    rows={1}
                    placeholder={`Message #${selectedRoom.slug}`}
                    aria-label="Message"
                  />
                  <span>{draft.length}/4096</span>
                </div>
                <button
                  type="submit"
                  disabled={!draft.trim() || sending || !socketConnected}
                  aria-label="Send message"
                >
                  {sending ? (
                    <Loader2 className="animate-spin" size={19} />
                  ) : (
                    <Send size={19} />
                  )}
                </button>
              </form>
            </>
          ) : (
            <div className="welcome-panel">
              <div className="welcome-copy">
                <p className="eyebrow">
                  <Sparkles size={14} /> Chat that gets you
                </p>
                <h2>
                  The world feels smaller
                  <span> when the room feels right.</span>
                </h2>
                <p>
                  Browse public spaces by language or interest. Join one, meet
                  someone new, and keep the conversation human.
                </p>
                <div className="promise-grid">
                  <span>
                    <Globe2 /> Global rooms
                  </span>
                  <span>
                    <MessageCircle /> Live messages
                  </span>
                  <span>
                    <Users /> Real community
                  </span>
                </div>
              </div>

              {!session && (
                <form className="auth-card" onSubmit={submitAuth}>
                  <div className="auth-tabs">
                    <button
                      type="button"
                      className={authMode === "login" ? "is-active" : ""}
                      onClick={() => setAuthMode("login")}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className={authMode === "register" ? "is-active" : ""}
                      onClick={() => setAuthMode("register")}
                    >
                      Create account
                    </button>
                  </div>
                  <div className="auth-heading">
                    <p className="eyebrow">Your seat is waiting</p>
                    <h3>
                      {authMode === "login" ? "Welcome back" : "Join ZestChat"}
                    </h3>
                  </div>
                  <label>
                    Email
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                    />
                  </label>
                  {authMode === "register" && (
                    <label>
                      Username
                      <input
                        required
                        minLength={3}
                        maxLength={30}
                        pattern="[a-zA-Z0-9_]+"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="your_name"
                      />
                    </label>
                  )}
                  <label>
                    Password
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={
                        authMode === "register"
                          ? "Upper, lower, number, symbol"
                          : "Your password"
                      }
                    />
                  </label>
                  <button className="auth-submit" disabled={authLoading}>
                    {authLoading ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <>
                        {authMode === "login" ? "Enter ZestChat" : "Create my account"}
                        <Send size={17} />
                      </>
                    )}
                  </button>
                  <p className="auth-footnote">
                    By continuing, you agree to keep public conversations kind
                    and safe.
                  </p>
                </form>
              )}

              {session && (
                <div className="signed-in-prompt">
                  <div className="spark-cluster small">
                    <Hash />
                  </div>
                  <h3>Choose a public room</h3>
                  <p>
                    Pick a room from the left. We will join it and bring in the
                    latest messages.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </section>

      <footer className="page-footer">
        <span>ZestChat MVP</span>
        <p lang="ar" dir="rtl">
          مساحة عالمية دافئة، لكل صوت فيها مكان.
        </p>
      </footer>
    </main>
  );
}
