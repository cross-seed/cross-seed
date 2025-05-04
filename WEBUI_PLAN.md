# Adding a Web UI for cross-seed

## Why do we want a web ui?

A web ui will lower the barrier to entry and make cross-seed more
accessible—many people are afraid of command line apps. In general, it is just a
more user-friendly interaction paradigm than config file edits and command line
usage.

## What do we want from a web ui?

-   monitor cross-seed's activity (logs, recent cross-seeds)
-   trigger specific searches
-   administer configuration without editing config file or needing to restart
-   putting documentation right in front of users
-   onboarding experience and app setup

A web ui will let people more easily monitor the health of cross-seed—even just
the ability to view logs is much less tedious than finding where cross-seed
stores its logs and tailing them from a terminal.

A web ui will let users change their settings much more easily, and with more
context, than modifying a config file while referencing static documentation. We
can show extra information right in the UI that helps users make decisions about
their settings.

A web ui will let us provide a smooth onboarding experience that doesn't start
with the app erroring on first launch.

## What stack do we want to use?

tRPC over Fastify for communication via an `/api/internal/trpc` path

shadcn/ui + tailwind as our component library

SQLite `settings` table for dynamic updates to configuration

new SQLite table for auth and single-user system, username + password with
bcryptjs

Vite for frontend build, served through Fastify from `dist` folder

## Requirements

Must leave doors open to support a base path, like `/cross-seed`.

## Implementation Checklist

### Backend Infrastructure

-   [ ] Refactor server.ts to use Fastify (✅ PR #960)
-   [ ] Set up tRPC integration with Fastify
    -   [ ] Create context handler for authentication
    -   [ ] Set up base router structure
-   [ ] Add SQLite schema migrations
    -   [ ] Create `settings` table for storing configuration
    -   [ ] Create `user` table for authentication
-   [ ] Configuration management
    -   [ ] Implement config hierarchy (CLI > file > database)
    -   [ ] Create migration system to move config from file to database
    -   [ ] Add watchers to reload settings when DB changes
-   [ ] Authentication system
    -   [ ] Implement JWT-based authentication
    -   [ ] Add login/logout endpoints
    -   [ ] Create command line tools for password reset
-   [ ] Create base path handling mechanism
    -   [ ] Support configurable base path without frontend recompilation
    -   [ ] Implement Server-Timing header approach for communicating base path

### Backend API Endpoints

-   [ ] Create tRPC router with procedures for:
    -   [ ] Authentication (login/logout)
    -   [ ] Settings management (get/update)
    -   [ ] Log access and streaming
    -   [ ] Search triggering
    -   [ ] Recent cross-seed results
    -   [ ] System status and statistics

### Frontend Setup

-   [ ] Initialize Vite project
-   [ ] Configure Tailwind and shadcn/ui
-   [ ] Set up tRPC client
-   [ ] Implement base path detection
-   [ ] Create layout template
    -   [ ] Navigation structure
    -   [ ] Authentication guard for protected routes

### Frontend Pages/Features

-   [ ] Login page
-   [ ] Dashboard/status page
    -   [ ] Activity summary
    -   [ ] Quick actions
-   [ ] Search interface
    -   [ ] Manual search form
    -   [ ] Search history/results
-   [ ] Settings management
    -   [ ] Categorized settings with contextual help
    -   [ ] Validation
-   [ ] Logs viewer
    -   [ ] Filtering options
    -   [ ] Real-time updates
-   [ ] Setup wizard for new users
    -   [ ] Step-by-step configuration
    -   [ ] Connectivity tests

### Documentation & Help

-   [ ] In-app documentation
-   [ ] Contextual tooltips for settings
-   [ ] Inline help text
-   [ ] Links to external documentation

### Integration & Testing

-   [ ] End-to-end tests for critical flows
-   [ ] Testing across different deployment scenarios
-   [ ] Backward compatibility with CLI operation
-   [ ] Testing base path functionality

### Deployment & Distribution

-   [ ] Update Dockerfile to include frontend build
-   [ ] Update installation documentation
-   [ ] Configure static asset serving
-   [ ] Update systemd service files if needed
