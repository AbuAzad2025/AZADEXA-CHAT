"use client";

import { FormEvent, RefObject, useState } from "react";
import {
  ArrowDown,
  Loader2,
  Mail,
  MessageCircleMore,
  Search,
  Send,
  UserRoundSearch,
} from "lucide-react";

export interface DirectUser {
  id: string;
  username: string;
  avatar: string | null;
  status?: string;
}

export interface PrivateMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: "TEXT";
  isRead: boolean;
  createdAt: string;
  sender: DirectUser;
  receiver: DirectUser;
}

export interface DirectConversation {
  user: DirectUser;
  lastMessage: PrivateMessage;
  unreadCount: number;
}

const initials = (name: string) => name.slice(0, 2).toUpperCase();

const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

interface DirectRailProps {
  conversations: DirectConversation[];
  searchResults: DirectUser[];
  selectedUserId: string | null;
  loading: boolean;
  searching: boolean;
  onSearch: (query: string) => void;
  onSelect: (user: DirectUser) => void;
}

export function DirectRail({
  conversations,
  searchResults,
  selectedUserId,
  loading,
  searching,
  onSearch,
  onSelect,
}: DirectRailProps) {
  const [query, setQuery] = useState("");

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    onSearch(query.trim());
  };

  return (
    <>
      <div className="rail-heading direct-rail-heading">
        <div>
          <p className="eyebrow">One-to-one</p>
          <h2>Direct messages</h2>
        </div>
        <span className="direct-rail-icon">
          <Mail size={17} />
        </span>
      </div>

      <form className="direct-search" onSubmit={submitSearch}>
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={2}
          maxLength={30}
          placeholder="Find a username"
          aria-label="Find a user by username"
        />
        <button
          type="submit"
          disabled={searching || query.trim().length < 2}
          aria-label="Search users"
        >
          {searching ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <UserRoundSearch size={14} />
          )}
        </button>
      </form>

      {searchResults.length > 0 && (
        <section className="direct-search-results">
          <p>People</p>
          {searchResults.map((user) => (
            <button key={user.id} onClick={() => onSelect(user)}>
              <span>{initials(user.username)}</span>
              <strong>@{user.username}</strong>
              <small>{user.status?.toLowerCase() || "member"}</small>
            </button>
          ))}
        </section>
      )}

      <div className="direct-list-label">Recent conversations</div>
      <div className="direct-conversation-list">
        {loading && conversations.length === 0 ? (
          <div className="rail-state compact">
            <Loader2 className="animate-spin" />
            <span>Loading messages...</span>
          </div>
        ) : conversations.length === 0 ? (
          <div className="rail-state compact">
            <MessageCircleMore />
            <strong>No direct messages yet</strong>
            <span>Search for someone to begin.</span>
          </div>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.user.id}
              className={`direct-conversation-card ${
                selectedUserId === conversation.user.id ? "is-active" : ""
              }`}
              onClick={() => onSelect(conversation.user)}
            >
              <span className="direct-avatar">
                {initials(conversation.user.username)}
              </span>
              <span className="direct-conversation-copy">
                <strong>@{conversation.user.username}</strong>
                <small>{conversation.lastMessage.content}</small>
              </span>
              <span className="direct-conversation-meta">
                <time>{formatTime(conversation.lastMessage.createdAt)}</time>
                {conversation.unreadCount > 0 && (
                  <b>{Math.min(conversation.unreadCount, 99)}</b>
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

interface DirectPanelProps {
  currentUserId: string;
  user: DirectUser | null;
  messages: PrivateMessage[];
  nextCursor: string | null;
  draft: string;
  loading: boolean;
  olderLoading: boolean;
  sending: boolean;
  connected: boolean;
  endRef: RefObject<HTMLDivElement | null>;
  onDraftChange: (value: string) => void;
  onLoadOlder: () => void;
  onSend: (event: FormEvent) => void;
}

export function DirectPanel({
  currentUserId,
  user,
  messages,
  nextCursor,
  draft,
  loading,
  olderLoading,
  sending,
  connected,
  endRef,
  onDraftChange,
  onLoadOlder,
  onSend,
}: DirectPanelProps) {
  if (!user) {
    return (
      <div className="direct-empty-panel">
        <span>
          <Mail />
        </span>
        <p className="eyebrow">Private conversation</p>
        <h2>Choose someone to message</h2>
        <p>
          Search by username or open a recent conversation. Direct messages are
          visible only to the two people in the conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="direct-panel">
      <header className="conversation-header direct-header">
        <div className="direct-header-person">
          <span>{initials(user.username)}</span>
          <div>
            <p className="eyebrow">Direct message</p>
            <h2>@{user.username}</h2>
            <p>
              {connected
                ? "Connected for live delivery"
                : "Messages will resume when the connection returns"}
            </p>
          </div>
        </div>
        <span className={`direct-live-pill ${connected ? "is-live" : ""}`}>
          <i />
          {connected ? "Live" : "Reconnecting"}
        </span>
      </header>

      <div className="direct-message-stage">
        {nextCursor && (
          <button
            className="older-button"
            onClick={onLoadOlder}
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

        {loading ? (
          <div className="conversation-state">
            <Loader2 className="animate-spin" />
            <span>Opening private conversation...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="conversation-state welcome-state">
            <span className="direct-empty-spark">
              <MessageCircleMore />
            </span>
            <h3>Say hello to @{user.username}</h3>
            <p>Keep it respectful. Reports still apply in direct messages.</p>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => {
              const mine = message.senderId === currentUserId;
              return (
                <article
                  className={`message-row direct-message-row ${
                    mine ? "is-mine" : ""
                  }`}
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
                      {mine && (
                        <span className="direct-read-state">
                          {message.isRead ? "Read" : "Sent"}
                        </span>
                      )}
                    </div>
                    <p>{message.content}</p>
                  </div>
                </article>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form className="composer direct-composer" onSubmit={onSend}>
        <div>
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={4096}
            rows={1}
            placeholder={`Message @${user.username}`}
            aria-label={`Message ${user.username}`}
          />
          <span>{draft.length}/4096</span>
        </div>
        <button
          type="submit"
          disabled={!draft.trim() || sending || !connected}
          aria-label={`Send private message to ${user.username}`}
        >
          {sending ? (
            <Loader2 className="animate-spin" size={19} />
          ) : (
            <Send size={19} />
          )}
        </button>
      </form>
    </div>
  );
}
