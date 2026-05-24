// Frontend streaming client for the LocationPage AI chatbot.
//
// Calls the `location-chat` Supabase Edge Function via direct fetch
// (supabase.functions.invoke buffers the response, which would
// defeat token-by-token streaming) and parses Anthropic's standard
// Server-Sent Events into a more ergonomic local event union.

import { supabase } from './supabase';

/* ── Wire types (sent to the Edge Function) ───────────────────── */

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export type AnthropicMessage =
  | { role: 'user'; content: string | ContentBlock[] }
  | { role: 'assistant'; content: ContentBlock[] };

export interface CompactRestaurant {
  id: string;
  name: string;
  cuisine?: string;
  price?: string;
  score?: string;
  neighborhood?: string;
  distance?: string;
}

export interface ChatFilters {
  cuisines?: string[];
  price?: number;
  neighborhoods?: string[];
  radius?: number;
  sort?: string;
}

export interface ChatRequest {
  messages: AnthropicMessage[];
  restaurants: CompactRestaurant[];
  filters: ChatFilters;
  city: string;
  model?: string;
}

/* ── Local event union (consumed by the chat component) ───────── */

export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; message: string };

/* ── Streaming consumer ───────────────────────────────────────── */

const SUPABASE_URL = (import.meta as ImportMeta & { env: Record<string, string> })
  .env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = (import.meta as ImportMeta & { env: Record<string, string> })
  .env.VITE_SUPABASE_ANON_KEY || '';

/**
 * Stream a chat turn from Claude (via the Edge Function). Yields
 * text_delta events as tokens arrive, complete tool_use events when
 * a tool call finishes, done at the message stop, or error on any
 * failure. Consumers can break out of the for-await loop at any
 * time — the underlying fetch is aborted via `signal` if provided.
 */
export async function* streamLocationChat(
  request: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  if (!SUPABASE_URL) {
    yield { type: 'error', message: 'Supabase URL not configured (VITE_SUPABASE_URL).' };
    return;
  }

  const url = `${SUPABASE_URL}/functions/v1/location-chat`;

  // Prefer the user's session token (so RLS / auth-gated edge functions
  // can identify them), fall back to the anon key.
  let authToken = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) authToken = data.session.access_token;
  } catch {
    // best-effort; fall through with anon key
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
    return;
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      msg = errBody?.error || msg;
    } catch {
      try { msg = (await res.text()).slice(0, 300) || msg; } catch { /* ignore */ }
    }
    yield { type: 'error', message: msg };
    return;
  }
  if (!res.body) {
    yield { type: 'error', message: 'No response body from server' };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Streaming tool_use blocks arrive in three phases: a start event
  // (id + name), one or more input_json_delta events that carry
  // chunks of the input as a JSON string, and a stop event. We
  // accumulate the JSON-string fragments here and parse + yield at
  // stop time so the consumer always gets a complete input object.
  let currentTool: { id: string; name: string; jsonBuffer: string } | null = null;
  let stopReason: string | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line ("\n\n"). Pull
      // complete events off the front of the buffer until we run
      // out of complete ones.
      let blankIdx: number;
      while ((blankIdx = buffer.indexOf('\n\n')) !== -1) {
        const eventChunk = buffer.slice(0, blankIdx);
        buffer = buffer.slice(blankIdx + 2);

        // Each chunk may have multiple `field: value` lines; we only
        // care about `data:` (Anthropic puts the JSON payload there).
        let dataPayload = '';
        for (const line of eventChunk.split('\n')) {
          if (line.startsWith('data:')) {
            dataPayload += (dataPayload ? '\n' : '') + line.slice(5).trimStart();
          }
        }
        if (!dataPayload || dataPayload === '[DONE]') continue;

        let event: { type: string; [k: string]: unknown };
        try {
          event = JSON.parse(dataPayload);
        } catch {
          continue;
        }

        switch (event.type) {
          case 'content_block_start': {
            const block = (event as { content_block?: { type: string; id: string; name: string } })
              .content_block;
            if (block?.type === 'tool_use') {
              currentTool = { id: block.id, name: block.name, jsonBuffer: '' };
            }
            break;
          }
          case 'content_block_delta': {
            const delta = (event as { delta?: { type: string; text?: string; partial_json?: string } })
              .delta;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              yield { type: 'text_delta', delta: delta.text };
            } else if (delta?.type === 'input_json_delta' && currentTool) {
              currentTool.jsonBuffer += delta.partial_json ?? '';
            }
            break;
          }
          case 'content_block_stop': {
            if (currentTool) {
              let input: unknown = {};
              if (currentTool.jsonBuffer) {
                try { input = JSON.parse(currentTool.jsonBuffer); }
                catch { input = {}; }
              }
              yield {
                type: 'tool_use',
                id: currentTool.id,
                name: currentTool.name,
                input,
              };
              currentTool = null;
            }
            break;
          }
          case 'message_delta': {
            const stop = (event as { delta?: { stop_reason?: string } }).delta?.stop_reason;
            if (stop) stopReason = stop;
            break;
          }
          case 'message_stop': {
            yield { type: 'done', stopReason };
            return;
          }
          case 'error': {
            const msg = (event as { error?: { message?: string } }).error?.message
              || 'Streaming error';
            yield { type: 'error', message: msg };
            return;
          }
        }
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
}
