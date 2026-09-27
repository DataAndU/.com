import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, Conversation, Message, Page, ProviderSummary } from "./client";

export function useConversations(cursor?: string, limit?: number) {
  return useQuery<Page<Conversation>>({
    queryKey: ["conversations", cursor, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (limit) params.set("limit", limit.toString());
      return fetchApi(`/conversations?${params.toString()}`);
    }
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation<{ conversation: Conversation; message: Message; usage: any }, Error, { listingId: string; providerId: string; initialMessage: string }>({
    mutationFn: (data) => fetchApi("/conversations", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["contact-usage"] });
    }
  });
}

export function useMessages(conversationId: string, after?: string, limit?: number) {
  return useQuery<{ messages: Message[]; nextAfter: string | null }>({
    queryKey: ["messages", conversationId, after, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      if (after) params.set("after", after);
      if (limit) params.set("limit", limit.toString());
      return fetchApi(`/conversations/${conversationId}/messages?${params.toString()}`);
    },
    enabled: !!conversationId,
    refetchInterval: 5000, // Poll for new messages
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation<Message, Error, { conversationId: string; text: string }>({
    mutationFn: ({ conversationId, text }) => fetchApi(`/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: (data, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });
}

export function useRevealContact() {
  const queryClient = useQueryClient();
  return useMutation<{ provider: ProviderSummary; usage: any }, Error, { listingId: string }>({
    mutationFn: ({ listingId }) => fetchApi(`/listings/${listingId}/contact`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-usage"] });
    }
  });
}

export function useContactUsage() {
  return useQuery<{ period: string; used: number; limit: number; paid: boolean; remaining: number }>({
    queryKey: ["contact-usage"],
    queryFn: () => fetchApi("/contact-usage"),
  });
}