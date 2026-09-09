# Live chat

Messages arrive through Supabase Postgres Changes. Conversations and read receipts also subscribe to updates. Opening the app, returning online, or rejoining the socket fetches missed history. The merge retains messages received during that fetch and confirms optimistic sends by UUID. Failed requests remain retryable; an HTTP error cannot downgrade a message already confirmed by realtime.

An open conversation subscribes to private `chat-activity:<conversation UUID>:<sender UUID>` broadcast topics. The payload contains only `idle`, `typing`, or `sending`; it never contains draft text. RLS allows participants to receive activity and each sender to publish only on their own topic. Activity is throttled, refreshed while active, and expires after five seconds without updates. Clearing/blurring the composer, finishing a send, leaving the chat, or backgrounding the app clears it earlier. A brand-new draft begins broadcasting after its first message creates the conversation.

Migration `20260909164751_live_chat_activity.sql` is applied to the connected Supabase project. It adds conversations to the realtime publication and the private activity policies. It does not change project-wide public channel settings used elsewhere. Both devices need the updated app for the new activity indicators.

Validation: automated two-client activity simulation; conversation subscription/reconnect/race tests; PostgreSQL RLS tests with isolated fixture users; message sharing, discovery, and social hub regressions. No test messages were sent to real users. A two-physical-device messaging session has not been performed.

Run the focused suite:

```sh
npx vitest run src/contexts/ChatContext.test.tsx src/hooks/useChatActivity.test.tsx src/lib/chat-reconcile.test.ts src/lib/chat-activity-security.test.ts src/lib/share-message.test.ts src/lib/message-discovery.test.ts src/pages/SocialHub.test.tsx
```
