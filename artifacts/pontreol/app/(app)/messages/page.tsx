"use client";

import { InboxTabs } from "@/components/inbox-tabs";
import { useConversations, useMessages, useSendMessage, useRevealContact, useContactUsage } from "@/lib/api/messages";
import { format } from "date-fns";
import { MessageSquare, Send, User, AlertCircle, RefreshCw } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useMe } from "@/lib/api/account";

export default function MessagesPage() {
  const { data: user } = useMe();
  const { data: convsData, isLoading: convsLoading } = useConversations();
  const { data: usageData } = useContactUsage();
  
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [msgText, setMsgText] = useState("");

  const { data: activeMessages, isLoading: messagesLoading } = useMessages(activeConvId || "");
  const sendMutation = useSendMessage();
  const revealMutation = useRevealContact();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgText.trim() || !activeConvId) return;
    sendMutation.mutate({ conversationId: activeConvId, text: msgText.trim() }, {
      onSuccess: () => setMsgText("")
    });
  };

  const activeConv = convsData?.items.find(c => c.id === activeConvId);
  const isBuyer = user?.id === activeConv?.buyerId;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <InboxTabs />
      {usageData && !usageData.paid && user?.role === "buyer" && (
        <p className="shrink-0 px-4 py-1.5 text-xs text-muted-foreground border-b border-border">Free contacts left this month: {usageData.remaining}</p>
      )}
      
      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar */}
        <div className={`w-full md:w-80 border-r border-border bg-card flex flex-col ${activeConvId ? 'hidden md:flex' : 'flex'}`}>
          {convsLoading ? (
            <div className="p-8 flex justify-center"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {convsData?.items.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => setActiveConvId(conv.id)}
                  className={`w-full text-left p-4 hover:bg-foreground/5 transition-colors ${activeConvId === conv.id ? 'bg-white/5' : ''}`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-semibold text-sm truncate">
                      {user?.id === conv.buyerId ? 'Provider' : 'Buyer'} (Listing {conv.listingId.substring(0, 4)})
                    </span>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {format(new Date(conv.lastMessageAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1">{conv.lastMessagePreview}</p>
                </button>
              ))}
              {(!convsData?.items || convsData.items.length === 0) && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No conversations yet.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div className={`flex-1 flex flex-col bg-background ${!activeConvId ? 'hidden md:flex' : 'flex'}`}>
          {activeConvId ? (
            <>
              {/* Header */}
              <div className="shrink-0 h-14 border-b border-border px-4 flex items-center justify-between bg-card md:bg-transparent">
                <div className="flex items-center gap-3">
                  <button className="md:hidden p-1 mr-1" onClick={() => setActiveConvId(null)}>←</button>
                  <User className="w-8 h-8 p-1.5 bg-secondary rounded-full" />
                  <div>
                    <div className="font-semibold text-sm">
                      {user?.id === activeConv?.buyerId ? 'Provider' : 'Buyer'}
                    </div>
                  </div>
                </div>
                {isBuyer && (
                  <button
                    onClick={() => {
                      if (activeConv && confirm("Revealing contact info consumes 1 free contact (if not paid). Continue?")) {
                        revealMutation.mutate({ listingId: activeConv.listingId }, {
                          onSuccess: (data) => {
                            const email = data.provider.contactEmail || "Unavailable";
                            const phone = data.provider.contactPhone || "Unavailable";
                            alert(`Email: ${email}\nPhone: ${phone}`);
                          }
                        });
                      }
                    }}
                    disabled={revealMutation.isPending}
                    className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded font-medium hover:bg-primary/90"
                  >
                    Reveal Contact Info
                  </button>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messagesLoading ? (
                  <div className="flex justify-center p-4"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  activeMessages?.messages.map(msg => {
                    const isMe = msg.senderId === user?.id;
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${isMe ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-card border border-border rounded-tl-sm'}`}>
                          {msg.text}
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-1 mx-1">
                          {format(new Date(msg.createdAt), "h:mm a")}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="shrink-0 p-4 border-t border-border bg-card md:bg-transparent">
                <form onSubmit={handleSend} className="flex gap-2 relative">
                  <input
                    type="text"
                    value={msgText}
                    onChange={(e) => setMsgText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 bg-input border border-border rounded-full pl-4 pr-12 py-2.5 text-sm focus:outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={!msgText.trim() || sendMutation.isPending}
                    className="absolute right-1 top-1 bottom-1 aspect-square bg-primary text-primary-foreground rounded-full flex items-center justify-center hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4 ml-0.5" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
              <p>Select a conversation to start messaging</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}