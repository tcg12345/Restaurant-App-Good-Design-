# Friends and Messages

`/messages` is the shared destination. Its Messages and Friends tabs replace the separate inbox and Friends pages. `/messages?tab=friends` opens Friends; existing `/circle` links redirect there. Home shortcuts, the shared top bar and the desktop sidebar each expose one combined destination, with a combined notification badge. The page shows unread messages and pending follow requests separately on the two tabs.

Messages retains inbox search, All/Unread/Shares filters, composing, direct and group conversations, and sharing. Friends retains requests, following/followers, contact discovery, people search, suggestions and experts. The old desktop Friends drawer is removed.

Tab changes replace the current history entry so Back leaves the page instead of cycling through tabs. Conversation URLs (`?conversation=…`, `?to=…`) and profile links using `openUserId` continue to work. The common header steps aside in mobile conversations; desktop keeps the tabs above the two-pane inbox. Only the active section is mounted, so hidden conversations cannot mark incoming messages read. Header controls stand down while a modal is open.

Validation:

```sh
npm run test -- src/pages/SocialHub.test.tsx src/lib/message-discovery.test.ts src/lib/nav-stack.test.ts src/lib/app-routes.test.ts
npm run ios:sync
```
