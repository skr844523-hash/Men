import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ban,
  Check,
  CheckCheck,
  Image as ImageIcon,
  MessageSquare,
  Mic,
  Reply,
  Search,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, formatRelativeArabic, uploadMediaDataUrl, uploadMediaFile } from '../lib/api';
import type { ChatMessage, Conversation, User } from '../types';

interface MessagesViewProps {
  currentUser: User;
  initialConversationId: number | null;
  lastWsEvent: Record<string, unknown> | null;
  syncSignal?: number;
  sendWsEvent?: (payload: Record<string, unknown>) => void;
  onUnreadRefresh: () => void;
  onOpenProfile: (username: string) => void;
  onToast: (msg: string) => void;
}

export const MessagesView: React.FC<MessagesViewProps> = ({
  currentUser,
  initialConversationId,
  lastWsEvent,
  syncSignal = 0,
  sendWsEvent,
  onUnreadRefresh,
  onOpenProfile,
  onToast,
}) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<number | null>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [recording, setRecording] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);

  const loadConversations = useCallback(() => {
    const q = searchQ.trim() ? `?q=${encodeURIComponent(searchQ.trim())}` : '';
    apiRequest<{ conversations: Conversation[] }>(`/messages/conversations${q}`)
      .then((res) => setConversations(res.conversations))
      .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر تحميل المحادثات.'))
      .finally(() => setLoadingList(false));
  }, [searchQ, onToast]);

  const loadMessages = useCallback(
    (convId: number) => {
      setLoadingChat(true);
      apiRequest<{ messages: ChatMessage[] }>(`/messages/conversations/${convId}`)
        .then((res) => {
          setMessages(res.messages);
          onUnreadRefresh();
          loadConversations();
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
        })
        .catch((err) => onToast(err instanceof Error ? err.message : 'تعذر فتح المحادثة.'))
        .finally(() => setLoadingChat(false));
    },
    [loadConversations, onToast, onUnreadRefresh]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations, syncSignal]);

  useEffect(() => {
    if (initialConversationId) {
      setSelectedConvId(initialConversationId);
    }
  }, [initialConversationId]);

  useEffect(() => {
    setPeerTyping(false);
    if (selectedConvId) {
      loadMessages(selectedConvId);
    }
  }, [selectedConvId, loadMessages, syncSignal]);

  // Live WebSocket updates
  useEffect(() => {
    if (!lastWsEvent) return;
    if (lastWsEvent.type === 'message:new') {
      const msg = lastWsEvent.message as ChatMessage;
      if (msg.conversationId === selectedConvId) {
        setPeerTyping(false);
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
        if (msg.senderId !== currentUser.id) {
          // Immediately mark read when recipient already has this conversation open
          sendWsEvent?.({ type: 'message:mark_read', conversationId: selectedConvId });
          apiRequest(`/messages/conversations/${selectedConvId}/read`, { method: 'POST' })
            .then(() => {
              onUnreadRefresh();
              loadConversations();
            })
            .catch(() => {});
          return;
        }
      }
      loadConversations();
    } else if (lastWsEvent.type === 'message:read' && lastWsEvent.conversationId === selectedConvId) {
      setMessages((prev) => prev.map((m) => ({ ...m, status: 'read' })));
    } else if (lastWsEvent.type === 'message:deleted' && lastWsEvent.conversationId === selectedConvId) {
      const deletedId = Number(lastWsEvent.messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === deletedId ? { ...m, deleted: true, content: 'تم حذف هذه الرسالة', mediaUrl: null } : m
        )
      );
    } else if (
      lastWsEvent.type === 'typing' &&
      Number(lastWsEvent.conversationId) === selectedConvId &&
      Number(lastWsEvent.userId) !== currentUser.id
    ) {
      setPeerTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setPeerTyping(false), 2600);
    } else if (
      lastWsEvent.type === 'conversation:updated' ||
      lastWsEvent.type === 'friend:accepted'
    ) {
      loadConversations();
    }
  }, [lastWsEvent, selectedConvId, currentUser.id, sendWsEvent, loadConversations, onUnreadRefresh]);

  const activeConv = conversations.find((c) => c.id === selectedConvId) || null;

  const sendMessage = async (payload: {
    content?: string;
    mediaUrl?: string;
    messageType?: 'text' | 'image' | 'audio';
  }) => {
    if (!selectedConvId) return;
    try {
      const res = await apiRequest<{ message: ChatMessage }>(
        `/messages/conversations/${selectedConvId}`,
        {
          method: 'POST',
          body: {
            content: payload.content ?? text,
            mediaUrl: payload.mediaUrl ?? null,
            messageType: payload.messageType ?? 'text',
            replyToId: replyTo?.id ?? null,
          },
        }
      );
      setText('');
      setReplyTo(null);
      setMessages((prev) =>
        prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
      );
      loadConversations();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إرسال الرسالة.');
    }
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadMediaFile(file);
      await sendMessage({ content: '', mediaUrl: url, messageType: 'image' });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر إرسال الصورة.');
    }
  };

  const toggleVoiceRecording = async () => {
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const url = await uploadMediaDataUrl(String(reader.result));
            await sendMessage({ content: '', mediaUrl: url, messageType: 'audio' });
          } catch (err) {
            onToast(err instanceof Error ? err.message : 'تعذر إرسال الرسالة الصوتية.');
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      onToast('يرجى السماح بصلاحية الميكروفون لتسجيل رسالة صوتية.');
    }
  };

  const handleDeleteMsg = async (msgId: number) => {
    try {
      await apiRequest(`/messages/${msgId}`, { method: 'DELETE' });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, deleted: true, content: 'تم حذف هذه الرسالة', mediaUrl: null } : m
        )
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر حذف الرسالة.');
    }
  };

  const handleRespondRequest = async (convId: number, action: 'accept' | 'decline') => {
    try {
      await apiRequest(`/messages/conversations/${convId}/respond`, {
        method: 'POST',
        body: { action },
      });
      if (action === 'decline') {
        setSelectedConvId(null);
      } else {
        loadMessages(convId);
      }
      loadConversations();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر تحديث طلب المراسلة.');
    }
  };

  const handleBlockPeer = async (peerId: number) => {
    try {
      await apiRequest(`/blocks/${peerId}`, { method: 'POST' });
      setSelectedConvId(null);
      loadConversations();
      onToast('تم حظر المستخدم ومنع تواصله معك.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'تعذر الحظر.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[70vh]">
      {/* Conversations List */}
      <div
        className={`lg:col-span-5 rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 flex flex-col overflow-hidden ${
          selectedConvId ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-slate-100 dark:border-white/8 space-y-3">
          <h2 className="font-display text-base font-bold flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-violet-500" />
            <span>الرسائل المباشرة</span>
          </h2>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="ابحث في المحادثات..."
              className="w-full min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 pr-9 pl-3 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
          {loadingList ? (
            <div className="p-6 text-center text-xs text-slate-400">جاري التحميل...</div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <MessageSquare className="w-8 h-8 text-violet-400 mx-auto" />
              <p className="text-sm font-semibold">لا توجد محادثات بعد</p>
              <p className="text-xs text-slate-400">
                يمكنك بدء محادثة من صفحة الأصدقاء أو ملف أي مستخدم.
              </p>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedConvId(c.id)}
                className={`w-full p-3.5 flex items-center gap-3 text-right transition-colors ${
                  selectedConvId === c.id
                    ? 'bg-violet-500/10'
                    : 'hover:bg-slate-50 dark:hover:bg-white/5'
                }`}
              >
                <div className="relative shrink-0">
                  <img
                    src={c.peer.avatar}
                    alt={c.peer.displayName}
                    className="w-11 h-11 rounded-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold truncate">{c.peer.displayName}</span>
                    {c.lastMessage && (
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {formatRelativeArabic(c.lastMessage.createdAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {c.status === 'request'
                        ? 'طلب مراسلة'
                        : c.lastMessage
                          ? c.lastMessage.content || 'مرفق'
                          : 'ابدأ المحادثة'}
                    </p>
                    {c.unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-violet-600 text-white text-[11px] font-mono flex items-center justify-center">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat Thread */}
      <div
        className={`lg:col-span-7 rounded-2xl bg-white dark:bg-[#12121A] border border-slate-200 dark:border-white/8 flex flex-col overflow-hidden ${
          selectedConvId ? 'flex' : 'hidden lg:flex'
        }`}
      >
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-2">
            <MessageSquare className="w-10 h-10 text-violet-400/70" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              اختر محادثة لعرض الرسائل الفورية
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="p-3.5 border-b border-slate-100 dark:border-white/8 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedConvId(null)}
                  className="lg:hidden min-h-[38px] px-2.5 rounded-xl bg-slate-100 dark:bg-white/5 text-xs"
                >
                  رجوع
                </button>
                <button
                  type="button"
                  onClick={() => onOpenProfile(activeConv.peer.username)}
                  className="flex items-center gap-2.5 text-right min-w-0"
                >
                  <img
                    src={activeConv.peer.avatar}
                    alt={activeConv.peer.displayName}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{activeConv.peer.displayName}</p>
                    <p className="text-[11px] text-slate-400">
                      {peerTyping ? (
                        <span className="text-violet-400 font-semibold">يكتب الآن...</span>
                      ) : activeConv.peer.isOnline ? (
                        'متصل الآن'
                      ) : (
                        `@${activeConv.peer.username}`
                      )}
                    </p>
                  </div>
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleBlockPeer(activeConv.peer.id)}
                className="min-h-[38px] px-3 rounded-xl border border-rose-500/30 text-rose-500 text-xs font-medium flex items-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>حظر</span>
              </button>
            </div>

            {/* Request Prompt if pending */}
            {activeConv.status === 'request' && !activeConv.isInitiator && (
              <div className="p-3.5 bg-violet-500/10 border-b border-violet-500/20 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-700 dark:text-slate-200">
                  طلب مراسلة جديد من {activeConv.peer.displayName}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRespondRequest(activeConv.id, 'accept')}
                    className="min-h-[34px] px-3 rounded-lg bg-violet-600 text-white text-xs font-semibold"
                  >
                    قبول
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRespondRequest(activeConv.id, 'decline')}
                    className="min-h-[34px] px-3 rounded-lg bg-rose-600/20 text-rose-400 text-xs font-semibold"
                  >
                    رفض
                  </button>
                </div>
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[54vh]">
              {loadingChat ? (
                <p className="text-center text-xs text-slate-400">جاري التحميل...</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-8">
                  ابدأ المحادثة بأول رسالة.
                </p>
              ) : (
                messages.map((m) => {
                  const isMine = m.senderId === currentUser.id;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isMine ? 'items-start' : 'items-end'}`}
                    >
                      <div
                        className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm space-y-1.5 ${
                          isMine
                            ? 'bg-violet-600 text-white rounded-tr-sm'
                            : 'bg-slate-100 dark:bg-[#1A1A26] text-slate-900 dark:text-slate-100 rounded-tl-sm'
                        }`}
                      >
                        {m.replyContent && (
                          <div className="text-[11px] opacity-80 border-r-2 border-white/40 pr-2 mb-1">
                            رد على: {m.replyContent}
                          </div>
                        )}
                        {m.mediaUrl && m.messageType === 'image' && (
                          <img
                            src={m.mediaUrl}
                            alt="صورة مرسلة"
                            className="rounded-xl max-h-56 object-cover"
                          />
                        )}
                        {m.mediaUrl && m.messageType === 'audio' && (
                          <audio controls src={m.mediaUrl} className="max-w-full" />
                        )}
                        {m.content && (
                          <p className={m.deleted ? 'italic opacity-70 text-xs' : 'leading-relaxed'}>
                            {m.content}
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-3 text-[10px] opacity-75">
                          <span>{formatRelativeArabic(m.createdAt)}</span>
                          <div className="flex items-center gap-1.5">
                            {!m.deleted && (
                              <button
                                type="button"
                                onClick={() => setReplyTo(m)}
                                aria-label="رد على الرسالة"
                                className="hover:opacity-100"
                              >
                                <Reply className="w-3 h-3" />
                              </button>
                            )}
                            {isMine && !m.deleted && (
                              <button
                                type="button"
                                onClick={() => handleDeleteMsg(m.id)}
                                aria-label="حذف الرسالة"
                                className="hover:opacity-100"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                            {isMine && (
                              <span aria-label={m.status}>
                                {m.status === 'read' ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-emerald-300" />
                                ) : m.status === 'delivered' ? (
                                  <CheckCheck className="w-3.5 h-3.5" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Reply Preview */}
            {replyTo && (
              <div className="px-4 py-2 bg-slate-50 dark:bg-white/5 border-t border-slate-100 dark:border-white/8 flex items-center justify-between text-xs">
                <span className="truncate">الرد على: {replyTo.content}</span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="إلغاء الرد">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) sendMessage({ content: text, messageType: 'text' });
              }}
              className="p-2.5 sm:p-3 border-t border-slate-100 dark:border-white/8 flex items-center gap-1.5 sm:gap-2 min-w-0"
            >
              <label
                className="min-h-[40px] min-w-[40px] shrink-0 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-violet-500 cursor-pointer"
                aria-label="إرسال صورة"
              >
                <ImageIcon className="w-4 h-4" />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleImagePick}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={toggleVoiceRecording}
                className={`min-h-[40px] min-w-[40px] shrink-0 flex items-center justify-center rounded-xl transition-colors ${
                  recording
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-violet-500'
                }`}
                aria-label={recording ? 'إيقاف التسجيل' : 'تسجيل رسالة صوتية'}
              >
                {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <input
                type="text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (selectedConvId && e.target.value.trim()) {
                    const now = Date.now();
                    if (now - lastTypingSentRef.current > 1500) {
                      lastTypingSentRef.current = now;
                      sendWsEvent?.({ type: 'typing', conversationId: selectedConvId });
                    }
                  }
                }}
                placeholder="اكتب رسالتك..."
                aria-label="نص الرسالة"
                className="flex-1 min-w-0 min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#09090D] border border-slate-200 dark:border-white/10 px-3 text-sm focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                className="min-h-[40px] min-w-[40px] shrink-0 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 text-white"
                aria-label="إرسال الرسالة"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
