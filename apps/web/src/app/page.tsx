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
  Bot,
  CheckCircle2,
  Clock3,
  Flag,
  Globe2,
  Hash,
  Languages,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import {
  DirectConversation,
  DirectPanel,
  DirectRail,
  DirectUser,
  PrivateMessage,
} from "@/components/DirectMessagesWorkspace";
import {
  AdminReport,
  ModerationFilter,
  ModerationPanel,
  ModerationRail,
  ModerationSummary,
  ReportStatus,
} from "@/components/ModerationWorkspace";
import {
  ReportDialog,
  ReportTarget,
  ReportType,
} from "@/components/ReportDialog";
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

interface ZestyMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  blocked?: boolean;
}

interface ZestyConversationSummary {
  id: string;
  flaggedContent: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string | null;
}

interface ZestyConversation {
  id: string;
  flaggedContent: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ZestyMessage[];
}

interface ZestyStatus {
  configured: boolean;
  dailyMessageLimit: number;
}

interface ZestyChatResult {
  conversation: ZestyConversation;
  reply: ZestyMessage;
  remainingMessages: number;
}

const STORAGE_KEY = "zestchat.session";

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const initials = (name: string) => name.slice(0, 2).toUpperCase();

const getBlockedConversationData = (
  value: unknown,
): { conversationId: string; remainingMessages?: number } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.conversationId !== "string") return null;

  return {
    conversationId: data.conversationId,
    ...(typeof data.remainingMessages === "number" && {
      remainingMessages: data.remainingMessages,
    }),
  };
};

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<
    "rooms" | "direct" | "zesty" | "moderation"
  >("rooms");
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
  const [zestyConfigured, setZestyConfigured] = useState<boolean | null>(null);
  const [zestyDailyLimit, setZestyDailyLimit] = useState(20);
  const [zestyRemaining, setZestyRemaining] = useState<number | null>(null);
  const [zestyConversations, setZestyConversations] = useState<
    ZestyConversationSummary[]
  >([]);
  const [zestyConversationId, setZestyConversationId] = useState<string | null>(
    null,
  );
  const [zestyMessages, setZestyMessages] = useState<ZestyMessage[]>([]);
  const [zestyDraft, setZestyDraft] = useState("");
  const [zestyLoading, setZestyLoading] = useState(false);
  const [zestySending, setZestySending] = useState(false);
  const [zestyDeleting, setZestyDeleting] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [moderationSummary, setModerationSummary] = useState<ModerationSummary>(
    {
      counts: {
        PENDING: 0,
        UNDER_REVIEW: 0,
        RESOLVED: 0,
        DISMISSED: 0,
      },
      open: 0,
    },
  );
  const [moderationReports, setModerationReports] = useState<AdminReport[]>([]);
  const [selectedModerationReport, setSelectedModerationReport] =
    useState<AdminReport | null>(null);
  const [moderationFilter, setModerationFilter] =
    useState<ModerationFilter>("ALL");
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationUpdating, setModerationUpdating] = useState(false);
  const [moderationResolution, setModerationResolution] = useState("");
  const [directConversations, setDirectConversations] = useState<
    DirectConversation[]
  >([]);
  const [directSearchResults, setDirectSearchResults] = useState<DirectUser[]>(
    [],
  );
  const [selectedDirectUser, setSelectedDirectUser] =
    useState<DirectUser | null>(null);
  const [directMessages, setDirectMessages] = useState<PrivateMessage[]>([]);
  const [directNextCursor, setDirectNextCursor] = useState<string | null>(null);
  const [directDraft, setDirectDraft] = useState("");
  const [directLoading, setDirectLoading] = useState(false);
  const [directSearching, setDirectSearching] = useState(false);
  const [directOlderLoading, setDirectOlderLoading] = useState(false);
  const [directSending, setDirectSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const selectedRoomRef = useRef<Room | null>(null);
  const selectedDirectUserRef = useRef<DirectUser | null>(null);
  const workspaceModeRef = useRef(workspaceMode);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const zestyEndRef = useRef<HTMLDivElement | null>(null);
  const directEndRef = useRef<HTMLDivElement | null>(null);
  const isModerator =
    session !== null &&
    ["MODERATOR", "ADMIN", "SUPER_ADMIN"].includes(session.user.role);

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
      setWorkspaceMode("rooms");
      setZestyConfigured(null);
      setZestyConversations([]);
      setZestyConversationId(null);
      setZestyMessages([]);
      setZestyRemaining(null);
      setReportTarget(null);
      setModerationReports([]);
      setSelectedModerationReport(null);
      setModerationFilter("ALL");
      setModerationResolution("");
      setDirectConversations([]);
      setDirectSearchResults([]);
      setSelectedDirectUser(null);
      setDirectMessages([]);
      setDirectNextCursor(null);
      setDirectDraft("");
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
    async <T,>(
      path: string,
      options: {
        method?: "GET" | "POST" | "PATCH" | "DELETE";
        body?: unknown;
      } = {},
    ) => {
      if (!session) throw new ApiError("Sign in to continue", 401);

      try {
        return await apiRequest<T>(path, {
          ...options,
          token: session.accessToken,
        });
      } catch (requestError) {
        if (
          !(requestError instanceof ApiError) ||
          requestError.status !== 401
        ) {
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
    [persistSession, refreshSession, session],
  );

  const loadRooms = useCallback(async () => {
    setRoomsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (language.trim()) params.set("language", language.trim());
    if (category.trim()) params.set("category", category.trim());

    try {
      const data = await apiRequest<Room[]>(
        `/api/v1/chat/rooms${params.size ? `?${params}` : ""}`,
      );
      setRooms(data);
      if (selectedRoom && !data.some((room) => room.id === selectedRoom.id)) {
        setSelectedRoom(null);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load rooms",
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
    selectedDirectUserRef.current = selectedDirectUser;
  }, [selectedDirectUser]);

  useEffect(() => {
    workspaceModeRef.current = workspaceMode;
  }, [workspaceMode]);

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
          : [...current, message],
      );
    });
    socket.on("private:new", (message: PrivateMessage) => {
      const otherUser =
        message.senderId === session.user.id
          ? message.receiver
          : message.sender;
      const conversationOpen =
        workspaceModeRef.current === "direct" &&
        selectedDirectUserRef.current?.id === otherUser.id;
      const incoming = message.receiverId === session.user.id;

      setDirectConversations((current) => {
        const existing = current.find(({ user }) => user.id === otherUser.id);
        return [
          {
            user: otherUser,
            lastMessage: message,
            unreadCount:
              incoming && !conversationOpen
                ? (existing?.unreadCount || 0) + 1
                : 0,
          },
          ...current.filter(({ user }) => user.id !== otherUser.id),
        ];
      });

      if (conversationOpen) {
        setDirectMessages((current) =>
          current.some(({ id }) => id === message.id)
            ? current
            : [...current, message],
        );
        if (incoming) {
          void apiRequest(`/api/v1/chat/private/${otherUser.id}/read`, {
            method: "POST",
            token: session.accessToken,
          });
        }
      }
    });
    socket.on("operation:error", ({ error: socketError }: { error: string }) =>
      setError(socketError),
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session?.accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    zestyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [zestyMessages.length]);

  useEffect(() => {
    directEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [directMessages.length]);

  const refreshZestyConversations = useCallback(async () => {
    const data = await authenticatedRequest<{
      conversations: ZestyConversationSummary[];
    }>("/api/v1/ai/conversations");
    setZestyConversations(data.conversations);
    return data.conversations;
  }, [authenticatedRequest]);

  const openZestyConversation = useCallback(
    async (conversationId: string) => {
      setZestyLoading(true);
      setError(null);
      try {
        const data = await authenticatedRequest<{
          conversation: ZestyConversation;
        }>(`/api/v1/ai/conversations/${conversationId}`);
        setZestyConversationId(data.conversation.id);
        setZestyMessages(data.conversation.messages);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to open this Zesty conversation",
        );
      } finally {
        setZestyLoading(false);
      }
    },
    [authenticatedRequest],
  );

  const loadZestyWorkspace = useCallback(async () => {
    if (!session) return;
    setZestyLoading(true);
    setError(null);

    try {
      const [status, conversations] = await Promise.all([
        authenticatedRequest<ZestyStatus>("/api/v1/ai/status"),
        refreshZestyConversations(),
      ]);
      setZestyConfigured(status.configured);
      setZestyDailyLimit(status.dailyMessageLimit);

      if (
        zestyConversationId &&
        conversations.some(({ id }) => id === zestyConversationId)
      ) {
        const data = await authenticatedRequest<{
          conversation: ZestyConversation;
        }>(`/api/v1/ai/conversations/${zestyConversationId}`);
        setZestyMessages(data.conversation.messages);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to open Zesty",
      );
    } finally {
      setZestyLoading(false);
    }
  }, [
    authenticatedRequest,
    refreshZestyConversations,
    session,
    zestyConversationId,
  ]);

  useEffect(() => {
    if (!session || workspaceMode !== "zesty") return;
    const timer = window.setTimeout(() => void loadZestyWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [session?.accessToken, workspaceMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNewZestyConversation = () => {
    setZestyConversationId(null);
    setZestyMessages([]);
    setZestyDraft("");
    setError(null);
  };

  const sendZestyMessage = async (event: FormEvent) => {
    event.preventDefault();
    const message = zestyDraft.trim();
    if (!message || zestySending || !zestyConfigured) return;

    setZestySending(true);
    setError(null);
    try {
      const data = await authenticatedRequest<ZestyChatResult>(
        "/api/v1/ai/chat",
        {
          method: "POST",
          body: {
            message,
            ...(zestyConversationId && {
              conversationId: zestyConversationId,
            }),
          },
        },
      );
      setZestyConversationId(data.conversation.id);
      setZestyMessages(data.conversation.messages);
      setZestyRemaining(data.remainingMessages);
      setZestyDraft("");
      await refreshZestyConversations();
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 400) {
        const blockedData = getBlockedConversationData(requestError.data);
        if (blockedData) {
          setZestyConversationId(blockedData.conversationId);
          setZestyRemaining(blockedData.remainingMessages ?? null);
          await openZestyConversation(blockedData.conversationId);
          await refreshZestyConversations();
        }
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Zesty could not answer right now",
      );
    } finally {
      setZestySending(false);
    }
  };

  const deleteZestyConversation = async () => {
    if (!zestyConversationId || zestyDeleting) return;
    setZestyDeleting(true);
    setError(null);
    try {
      await authenticatedRequest<{ deleted: boolean }>(
        `/api/v1/ai/conversations/${zestyConversationId}`,
        { method: "DELETE" },
      );
      startNewZestyConversation();
      await refreshZestyConversations();
      setNotice("Zesty conversation deleted.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to delete this conversation",
      );
    } finally {
      setZestyDeleting(false);
    }
  };

  const loadModerationWorkspace = useCallback(async () => {
    if (!isModerator) return;
    setModerationLoading(true);
    setError(null);

    try {
      const query =
        moderationFilter === "ALL"
          ? ""
          : `?status=${encodeURIComponent(moderationFilter)}`;
      const [summary, reportPage] = await Promise.all([
        authenticatedRequest<ModerationSummary>(
          "/api/v1/admin/reports/summary",
        ),
        authenticatedRequest<{
          reports: AdminReport[];
          nextCursor: string | null;
        }>(`/api/v1/admin/reports${query}`),
      ]);
      setModerationSummary(summary);
      setModerationReports(reportPage.reports);

      const nextSelection = reportPage.reports[0] || null;
      setSelectedModerationReport(nextSelection);
      setModerationResolution(nextSelection?.resolution || "");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load the moderation queue",
      );
    } finally {
      setModerationLoading(false);
    }
  }, [authenticatedRequest, isModerator, moderationFilter]);

  useEffect(() => {
    if (workspaceMode !== "moderation" || !isModerator) return;
    const timer = window.setTimeout(() => void loadModerationWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [isModerator, loadModerationWorkspace, workspaceMode]);

  const selectModerationReport = (report: AdminReport) => {
    setSelectedModerationReport(report);
    setModerationResolution(report.resolution || "");
  };

  const updateModerationReport = async (
    status: Exclude<ReportStatus, "PENDING">,
  ) => {
    if (!selectedModerationReport || moderationUpdating) return;
    const finalStatus = status === "RESOLVED" || status === "DISMISSED";
    if (finalStatus && moderationResolution.trim().length < 5) {
      setError("Add a short resolution before closing this report.");
      return;
    }

    setModerationUpdating(true);
    setError(null);
    try {
      await authenticatedRequest<{ report: AdminReport }>(
        `/api/v1/admin/reports/${selectedModerationReport.id}`,
        {
          method: "PATCH",
          body: {
            status,
            ...(finalStatus && {
              resolution: moderationResolution.trim(),
            }),
          },
        },
      );
      setNotice(
        status === "UNDER_REVIEW"
          ? "Report marked as under review."
          : `Report ${status.toLowerCase()}.`,
      );
      await loadModerationWorkspace();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update this report",
      );
    } finally {
      setModerationUpdating(false);
    }
  };

  const submitReport = async (type: ReportType, reason: string) => {
    if (!reportTarget || reportSubmitting) return;
    setReportSubmitting(true);
    setError(null);

    try {
      await authenticatedRequest<{ report: { id: string } }>(
        "/api/v1/reports",
        {
          method: "POST",
          body: {
            reportedUserId: reportTarget.reportedUserId,
            type,
            reason,
            evidence: [
              `room:${reportTarget.roomName}`,
              `message:${reportTarget.messageId}`,
              `excerpt:${reportTarget.excerpt}`,
            ].join("\n"),
          },
        },
      );
      setReportTarget(null);
      setNotice("Thanks. The safety team will review your report.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to submit this report",
      );
    } finally {
      setReportSubmitting(false);
    }
  };

  const loadDirectConversations = useCallback(async () => {
    if (!session) return;
    setDirectLoading(true);
    setError(null);
    try {
      const data = await authenticatedRequest<{
        conversations: DirectConversation[];
      }>("/api/v1/chat/private/conversations");
      setDirectConversations(data.conversations);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load direct messages",
      );
    } finally {
      setDirectLoading(false);
    }
  }, [authenticatedRequest, session]);

  useEffect(() => {
    if (workspaceMode !== "direct" || !session) return;
    const timer = window.setTimeout(() => void loadDirectConversations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDirectConversations, session, workspaceMode]);

  const searchDirectUsers = async (query: string) => {
    if (query.length < 2) {
      setDirectSearchResults([]);
      return;
    }
    setDirectSearching(true);
    setError(null);
    try {
      const data = await authenticatedRequest<{ users: DirectUser[] }>(
        `/api/v1/users/search?q=${encodeURIComponent(query)}`,
      );
      setDirectSearchResults(data.users);
      if (data.users.length === 0) {
        setNotice("No matching usernames found.");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to search users",
      );
    } finally {
      setDirectSearching(false);
    }
  };

  const openDirectConversation = async (user: DirectUser) => {
    setSelectedDirectUser(user);
    setDirectSearchResults([]);
    setDirectMessages([]);
    setDirectNextCursor(null);
    setDirectLoading(true);
    setError(null);
    try {
      const data = await authenticatedRequest<{
        user: DirectUser;
        messages: PrivateMessage[];
        nextCursor: string | null;
      }>(`/api/v1/chat/private/${user.id}/messages?limit=50`);
      await authenticatedRequest<{ updatedCount: number }>(
        `/api/v1/chat/private/${user.id}/read`,
        { method: "POST" },
      );
      setSelectedDirectUser(data.user);
      setDirectMessages(
        data.messages.map((message) =>
          message.receiverId === session?.user.id
            ? { ...message, isRead: true }
            : message,
        ),
      );
      setDirectNextCursor(data.nextCursor);
      setDirectConversations((current) =>
        current.map((conversation) =>
          conversation.user.id === user.id
            ? { ...conversation, unreadCount: 0 }
            : conversation,
        ),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to open this conversation",
      );
    } finally {
      setDirectLoading(false);
    }
  };

  const loadOlderDirectMessages = async () => {
    if (!selectedDirectUser || !directNextCursor || directOlderLoading) return;
    setDirectOlderLoading(true);
    try {
      const data = await authenticatedRequest<{
        messages: PrivateMessage[];
        nextCursor: string | null;
      }>(
        `/api/v1/chat/private/${selectedDirectUser.id}/messages?limit=50&before=${encodeURIComponent(
          directNextCursor,
        )}`,
      );
      setDirectMessages((current) => [...data.messages, ...current]);
      setDirectNextCursor(data.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load earlier messages",
      );
    } finally {
      setDirectOlderLoading(false);
    }
  };

  const sendDirectMessage = (event: FormEvent) => {
    event.preventDefault();
    const content = directDraft.trim();
    if (
      !content ||
      !selectedDirectUser ||
      !socketRef.current ||
      directSending
    ) {
      return;
    }

    setDirectSending(true);
    setError(null);
    socketRef.current.emit(
      "private:send",
      { receiverId: selectedDirectUser.id, content },
      (response: SocketAck<{ message: PrivateMessage }>) => {
        setDirectSending(false);
        if (!response.success) {
          setError(response.error || "Unable to send private message");
          return;
        }
        setDirectDraft("");
      },
    );
  };

  const loadHistory = useCallback(
    async (roomId: string) => {
      setHistoryLoading(true);
      setMessages([]);
      setNextCursor(null);
      try {
        const page = await authenticatedRequest<MessagePage>(
          `/api/v1/chat/rooms/${roomId}/messages?limit=50`,
        );
        setMessages(page.messages);
        setNextCursor(page.nextCursor);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load messages",
        );
      } finally {
        setHistoryLoading(false);
      }
    },
    [authenticatedRequest],
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
        { method: "POST" },
      );
      if (selectedRoom && selectedRoom.id !== room.id) {
        socketRef.current?.emit("room:leave", { roomId: selectedRoom.id });
      }
      setSelectedRoom(room);
      socketRef.current?.emit(
        "room:join",
        { roomId: room.id },
        (response: SocketAck<{ roomId: string }>) => {
          if (!response.success)
            setError(response.error || "Unable to connect");
        },
      );
      await loadHistory(room.id);
      setNotice(`You joined ${room.name}.`);
      void loadRooms();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to join room",
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
        { method: "POST" },
      );
      socketRef.current?.emit("room:leave", { roomId: selectedRoom.id });
      setNotice(`You left ${selectedRoom.name}.`);
      setSelectedRoom(null);
      setMessages([]);
      setNextCursor(null);
      void loadRooms();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to leave room",
      );
    }
  };

  const loadOlder = async () => {
    if (!selectedRoom || !nextCursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const page = await authenticatedRequest<MessagePage>(
        `/api/v1/chat/rooms/${selectedRoom.id}/messages?limit=50&before=${encodeURIComponent(
          nextCursor,
        )}`,
      );
      setMessages((current) => [...page.messages, ...current]);
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load older messages",
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
      },
    );
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setAuthLoading(true);
    setError(null);

    try {
      const data = await apiRequest<Session>(`/api/v1/auth/${authMode}`, {
        method: "POST",
        body:
          authMode === "register"
            ? { email, username, password }
            : { email, password },
      });
      persistSession(data);
      setPassword("");
      setNotice(
        authMode === "register"
          ? `Welcome to ZestChat, ${data.user.username}.`
          : `Welcome back, ${data.user.username}.`,
      );
      if (selectedRoom) await joinRoomWithSession(selectedRoom, data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Authentication failed",
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const joinRoomWithSession = async (room: Room, activeSession: Session) => {
    try {
      await apiRequest<{ roomId: string }>(
        `/api/v1/chat/rooms/${room.id}/join`,
        { method: "POST", token: activeSession.accessToken },
      );
      const page = await apiRequest<MessagePage>(
        `/api/v1/chat/rooms/${room.id}/messages?limit=50`,
        { token: activeSession.accessToken },
      );
      setMessages(page.messages);
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to join room",
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
    setError(null);
    setNotice("You are signed out.");
  };

  const roomLanguages = useMemo(
    () => Array.from(new Set(rooms.map((room) => room.language))).sort(),
    [rooms],
  );
  const directUnreadCount = useMemo(
    () =>
      directConversations.reduce(
        (total, conversation) => total + conversation.unreadCount,
        0,
      ),
    [directConversations],
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
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <div className="ink-orbit ink-orbit-one" aria-hidden="true" />
      <div className="ink-orbit ink-orbit-two" aria-hidden="true" />

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
          <div
            className={`connection-pill ${socketConnected ? "is-live" : ""}`}
            role="status"
            aria-live="polite"
          >
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
              <button
                className="icon-button"
                onClick={logout}
                title="Sign out"
                aria-label="Sign out"
              >
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
        <div
          className={`toast-strip ${error ? "is-error" : ""}`}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
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

      <section
        id="workspace"
        className={`chat-shell ${session ? "is-authenticated" : "is-guest"}`}
        tabIndex={-1}
      >
        <aside className="room-rail">
          <nav
            className={`workspace-switch ${isModerator ? "has-admin" : ""}`}
            aria-label="Workspace"
          >
            <button
              className={workspaceMode === "rooms" ? "is-active" : ""}
              onClick={() => setWorkspaceMode("rooms")}
              aria-pressed={workspaceMode === "rooms"}
            >
              <Globe2 size={15} />
              Rooms
            </button>
            <button
              className={workspaceMode === "direct" ? "is-active" : ""}
              onClick={() => {
                if (!session) return;
                setWorkspaceMode("direct");
                if (selectedDirectUser) {
                  void openDirectConversation(selectedDirectUser);
                }
              }}
              disabled={!session}
              title={
                session ? "Open direct messages" : "Sign in to message people"
              }
              aria-pressed={workspaceMode === "direct"}
            >
              <Mail size={15} />
              Direct
              {directUnreadCount > 0 && (
                <span className="workspace-unread">
                  {Math.min(directUnreadCount, 99)}
                </span>
              )}
            </button>
            <button
              className={workspaceMode === "zesty" ? "is-active" : ""}
              onClick={() => session && setWorkspaceMode("zesty")}
              disabled={!session}
              title={session ? "Open Zesty" : "Sign in to ask Zesty"}
              aria-pressed={workspaceMode === "zesty"}
            >
              <Sparkles size={15} />
              Zesty
            </button>
            {isModerator && (
              <button
                className={workspaceMode === "moderation" ? "is-active" : ""}
                onClick={() => setWorkspaceMode("moderation")}
                title="Open the moderation queue"
                aria-pressed={workspaceMode === "moderation"}
              >
                <ShieldAlert size={15} />
                Safety
              </button>
            )}
          </nav>

          {workspaceMode === "rooms" ? (
            <>
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
                  <RefreshCw
                    size={17}
                    className={roomsLoading ? "animate-spin" : ""}
                  />
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
                    aria-label="Filter rooms by language"
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
                    aria-label="Filter rooms by category"
                  />
                </label>
                <button className="filter-button" type="submit">
                  Explore
                </button>
              </form>

              <div
                className="room-list"
                aria-live="polite"
                aria-busy={roomsLoading}
              >
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
                      <p>
                        {room.description || "A public place to meet and talk."}
                      </p>
                      <div className="room-meta">
                        <span>
                          <Users size={14} />
                          {room.memberCount}/{room.maxUsers}
                        </span>
                        <span>{room.category || "General"}</span>
                      </div>
                      {joiningRoomId === room.id && (
                        <Loader2
                          className="room-loader animate-spin"
                          size={18}
                        />
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : workspaceMode === "direct" ? (
            <DirectRail
              conversations={directConversations}
              searchResults={directSearchResults}
              selectedUserId={selectedDirectUser?.id || null}
              loading={directLoading}
              searching={directSearching}
              onSearch={(query) => void searchDirectUsers(query)}
              onSelect={(user) => void openDirectConversation(user)}
            />
          ) : workspaceMode === "zesty" ? (
            <>
              <div className="rail-heading zesty-rail-heading">
                <div>
                  <p className="eyebrow">Private to your account</p>
                  <h2>Zesty notes</h2>
                </div>
                <button
                  className="icon-button soft"
                  onClick={startNewZestyConversation}
                  aria-label="Start a new Zesty conversation"
                >
                  <Plus size={18} />
                </button>
              </div>

              <div
                className={`zesty-status-card ${
                  zestyConfigured === false ? "is-offline" : ""
                }`}
              >
                <span>
                  {zestyConfigured === null ? (
                    <Loader2 className="animate-spin" size={15} />
                  ) : zestyConfigured ? (
                    <ShieldCheck size={16} />
                  ) : (
                    <Clock3 size={16} />
                  )}
                </span>
                <div>
                  <strong>
                    {zestyConfigured === false
                      ? "Waiting for setup"
                      : "Safety Shield active"}
                  </strong>
                  <small>
                    {zestyRemaining === null
                      ? `${zestyDailyLimit} messages each day`
                      : `${zestyRemaining} messages left today`}
                  </small>
                </div>
              </div>

              <div className="zesty-conversation-list">
                <div className="zesty-list-label">
                  <span>Recent conversations</span>
                  <button
                    onClick={() => void loadZestyWorkspace()}
                    aria-label="Refresh Zesty conversations"
                  >
                    <RefreshCw
                      size={14}
                      className={zestyLoading ? "animate-spin" : ""}
                    />
                  </button>
                </div>
                {zestyLoading && zestyConversations.length === 0 ? (
                  <div className="rail-state compact">
                    <Loader2 className="animate-spin" />
                    <span>Opening your notes...</span>
                  </div>
                ) : zestyConversations.length === 0 ? (
                  <div className="rail-state compact">
                    <Bot />
                    <strong>No conversations yet</strong>
                    <span>Start with one honest question.</span>
                  </div>
                ) : (
                  zestyConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      className={`zesty-conversation-card ${
                        zestyConversationId === conversation.id
                          ? "is-active"
                          : ""
                      }`}
                      onClick={() =>
                        void openZestyConversation(conversation.id)
                      }
                    >
                      <span className="zesty-conversation-icon">
                        <Sparkles size={15} />
                      </span>
                      <span>
                        <strong>
                          {conversation.preview || "A new conversation"}
                        </strong>
                        <small>
                          {conversation.messageCount} notes ·{" "}
                          {formatTime(conversation.updatedAt)}
                        </small>
                      </span>
                      {conversation.flaggedContent && (
                        <ShieldCheck
                          className="zesty-card-shield"
                          size={14}
                          aria-label="Safety filter was used"
                        />
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <ModerationRail
              summary={moderationSummary}
              reports={moderationReports}
              selectedId={selectedModerationReport?.id || null}
              filter={moderationFilter}
              loading={moderationLoading}
              onFilterChange={setModerationFilter}
              onRefresh={() => void loadModerationWorkspace()}
              onSelect={selectModerationReport}
            />
          )}
        </aside>

        <section className="conversation-panel">
          {workspaceMode === "direct" && session ? (
            <DirectPanel
              currentUserId={session.user.id}
              user={selectedDirectUser}
              messages={directMessages}
              nextCursor={directNextCursor}
              draft={directDraft}
              loading={directLoading}
              olderLoading={directOlderLoading}
              sending={directSending}
              connected={socketConnected}
              endRef={directEndRef}
              onDraftChange={setDirectDraft}
              onLoadOlder={() => void loadOlderDirectMessages()}
              onSend={sendDirectMessage}
            />
          ) : workspaceMode === "moderation" && isModerator ? (
            <ModerationPanel
              report={selectedModerationReport}
              resolution={moderationResolution}
              updating={moderationUpdating}
              onResolutionChange={setModerationResolution}
              onUpdate={(status) => void updateModerationReport(status)}
            />
          ) : workspaceMode === "zesty" && session ? (
            <div className="zesty-panel">
              <header className="conversation-header zesty-header">
                <div>
                  <p className="eyebrow">
                    <ShieldCheck size={14} /> Safety Shield · Layer 1
                  </p>
                  <h2>Zesty</h2>
                  <p>
                    A calm place to think out loud, get unstuck, or turn a big
                    question into one small next step.
                  </p>
                </div>
                {zestyConversationId && (
                  <button
                    className="delete-conversation-button"
                    onClick={() => void deleteZestyConversation()}
                    disabled={zestyDeleting}
                  >
                    {zestyDeleting ? (
                      <Loader2 className="animate-spin" size={15} />
                    ) : (
                      <Trash2 size={15} />
                    )}
                    Delete
                  </button>
                )}
              </header>

              <div className="zesty-message-stage" aria-live="polite">
                {zestyLoading && zestyMessages.length === 0 ? (
                  <div className="conversation-state">
                    <Loader2 className="animate-spin" />
                    <span>Warming up Zesty...</span>
                  </div>
                ) : zestyConfigured === false ? (
                  <div className="zesty-unavailable-card">
                    <span className="zesty-seal">
                      <Clock3 />
                    </span>
                    <p className="eyebrow">Almost ready</p>
                    <h3>Zesty is waiting for a server key.</h3>
                    <p>
                      Add <code>OPENAI_API_KEY</code> to the API environment.
                      The key stays on the server and is never sent to this
                      browser.
                    </p>
                  </div>
                ) : zestyMessages.length === 0 ? (
                  <div className="zesty-welcome">
                    <div className="zesty-orb" aria-hidden="true">
                      <Sparkles />
                      <span>Z</span>
                    </div>
                    <p className="eyebrow">A private thinking corner</p>
                    <h3>Hey {session.user.username}, what is on your mind?</h3>
                    <p>
                      Zesty is friendly and useful, but not a doctor or an
                      emergency service. Avoid sharing sensitive personal
                      information.
                    </p>
                    <div className="zesty-prompts">
                      {[
                        "Help me break down a study goal",
                        "Give me a kind icebreaker",
                        "Explain something complicated simply",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => setZestyDraft(prompt)}
                        >
                          <Sparkles size={14} />
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="zesty-message-list">
                    {zestyMessages.map((message, index) => (
                      <article
                        className={`zesty-message-row is-${message.role} ${
                          message.blocked ? "is-blocked" : ""
                        }`}
                        key={`${message.createdAt}-${index}`}
                      >
                        {message.role === "assistant" && (
                          <div className="zesty-avatar">
                            <Sparkles size={15} />
                          </div>
                        )}
                        <div className="zesty-message-content">
                          <div className="message-byline">
                            <strong>
                              {message.role === "assistant" ? "Zesty" : "You"}
                            </strong>
                            {message.blocked && (
                              <span className="safety-label">
                                <ShieldCheck size={12} /> Filtered
                              </span>
                            )}
                            <time>{formatTime(message.createdAt)}</time>
                          </div>
                          <p>{message.content}</p>
                        </div>
                      </article>
                    ))}
                    <div ref={zestyEndRef} />
                  </div>
                )}
              </div>

              <form className="zesty-composer" onSubmit={sendZestyMessage}>
                <div className="zesty-safety-note">
                  <ShieldCheck size={14} />
                  Input and output are checked before display.
                </div>
                <div className="zesty-composer-row">
                  <div>
                    <textarea
                      value={zestyDraft}
                      onChange={(event) => setZestyDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      maxLength={2000}
                      rows={2}
                      placeholder={
                        zestyConfigured === false
                          ? "Zesty needs server configuration"
                          : "Ask Zesty something..."
                      }
                      aria-label="Message Zesty"
                      disabled={zestyConfigured !== true}
                    />
                    <span>{zestyDraft.length}/2000</span>
                  </div>
                  <button
                    type="submit"
                    disabled={
                      !zestyDraft.trim() ||
                      zestySending ||
                      zestyConfigured !== true
                    }
                    aria-label="Send message to Zesty"
                  >
                    {zestySending ? (
                      <Loader2 className="animate-spin" size={19} />
                    ) : (
                      <Send size={19} />
                    )}
                  </button>
                </div>
              </form>
            </div>
          ) : selectedRoom && session ? (
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
                <button
                  className="leave-button"
                  onClick={() => void leaveRoom()}
                >
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
                              <strong>
                                {mine ? "You" : message.sender.username}
                              </strong>
                              <time>{formatTime(message.createdAt)}</time>
                              {!mine && (
                                <button
                                  className="message-report-button"
                                  onClick={() =>
                                    setReportTarget({
                                      reportedUserId: message.sender.id,
                                      username: message.sender.username,
                                      roomName: selectedRoom.slug,
                                      messageId: message.id,
                                      excerpt: message.content.slice(0, 300),
                                    })
                                  }
                                  title={`Report @${message.sender.username}`}
                                  aria-label={`Report message from ${message.sender.username}`}
                                >
                                  <Flag size={12} />
                                  Report
                                </button>
                              )}
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
                        {authMode === "login"
                          ? "Enter ZestChat"
                          : "Create my account"}
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

      <ReportDialog
        key={reportTarget?.messageId || "closed-report-dialog"}
        target={reportTarget}
        submitting={reportSubmitting}
        onClose={() => setReportTarget(null)}
        onSubmit={submitReport}
      />

      <footer className="page-footer">
        <span>ZestChat MVP</span>
        <p lang="ar" dir="rtl">
          مساحة عالمية دافئة، لكل صوت فيها مكان.
        </p>
      </footer>
    </main>
  );
}
