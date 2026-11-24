---
name: tickets
description: Manage dependencies, statuses, and change history for local Markdown tickets.
disable-model-invocation: true
---

# Tickets

## Getting started

Use Tickets after the user explicitly enables it for the selected ticket set. Run `pnpm dlx @ykdz/tickets@latest --help` for commands and `npm view @ykdz/tickets@latest readme` for the ticket file format.

Follow the project's ticket conventions and existing configuration. If there is no configuration, initialize one with the project's ticket directory and completion values.

## Coordinating work

Use the original requirements and evidence to decide scope, priorities, assignments, and acceptance. Tickets checks declared structure. Assess requirements coverage, missing dependencies, and delivery yourself.

- A ticket is unblocked when all of its declared direct prerequisites are marked complete. Choose assignment order and scope based on the work itself.
- When a prerequisite is outstanding, advance any work that can proceed independently. Wait for its deliverable before starting work that requires it.
- Mark a ticket complete once its agreed deliverable is available and dependent tickets can proceed on that basis. If agreed work remains, use Tickets to restore an appropriate incomplete status and review affected dependent tickets.

## Maintaining ticket data

Ticket files are the source of truth for current data. Use history to trace changes. Keep ticket identifiers stable after creation and edit the Markdown body as needed.

Set initial field values when creating a ticket. Use Tickets for later status and dependency changes. Edit the body and run write commands at different times for the same ticket. Preserve machine-managed fields.

If a malformed field prevents Tickets from reading a file, fix only its format, preserve the original value, and run a check. Repair structural problems ticket by ticket and check for remaining issues after each change.

If a change fails, compare the result with the actual ticket files and history before retrying. Changes already saved still apply. If a query fails, resolve the failure before drawing conclusions about outstanding work.
