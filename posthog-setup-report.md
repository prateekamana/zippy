<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Zippy task manager app. The project is a React/Vite/Electron application with a Node.js backend. PostHog was integrated on two layers: the server side (using `posthog-node`) and the client side (using `posthog-js`). Environment variables are stored in `.env` and loaded via `dotenv` on the server and via Vite's `import.meta.env` on the client. Users are identified by username on successful login using `posthog.identify()` on the client, and the same username is used as `distinctId` on the server to correlate events across both layers.

| Event | Description | File |
|---|---|---|
| `user_logged_in` | User successfully authenticated and a session was created | `server.js` |
| `login_failed` | User attempted to log in with invalid credentials | `server.js` |
| `tasks_synced` | Tasks were refreshed and synced from the external source (Asana/Google Sheets) | `server.js` |
| `user_identified` | User identity linked in PostHog on successful client-side login | `src/Login.jsx` |
| `filter_applied` | User applied a filter on the task list (project, assignee, date) | `src/Tasks.jsx` |
| `sheet_link_opened` | User clicked to open a task in Google Sheets | `src/Tasks.jsx` |
| `project_toggled` | User collapsed or expanded a project accordion section | `src/Tasks.jsx` |
| `tasks_refreshed` | User triggered a manual refresh of tasks | `src/Tasks.jsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics](https://us.posthog.com/project/372525/dashboard/1439428)
- **Insight**: [Login success vs. failures](https://us.posthog.com/project/372525/insights/m38EfclZ)
- **Insight**: [Login → filter applied (conversion funnel)](https://us.posthog.com/project/372525/insights/XzGAgvjB)
- **Insight**: [Filter usage by type](https://us.posthog.com/project/372525/insights/Wsxzy1sR)
- **Insight**: [Task syncs and manual refreshes](https://us.posthog.com/project/372525/insights/4VxbYHK3)
- **Insight**: [Sheet link opens and project toggles](https://us.posthog.com/project/372525/insights/m0av7bWH)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
