# ADR-0001: Record architecture decisions

**Status:** Accepted
**Date:** 2026-06-26

## Context

This project is developed largely by Claude Code sessions whose context windows are
finite and can be reset at any time. Decisions made in one session — why folders live
in `chrome.storage.local`, why the server is optional, which selectors automate
NotebookLM — are easily lost when the conversation that produced them ends. Without a
durable record, future sessions re-derive (or accidentally reverse) earlier choices,
wasting context and risking regressions. We need a lightweight, on-disk decision
history that onboards a fresh session quickly and survives context-window resets.

## Decision

We will record significant architectural and product decisions as numbered
**Architecture Decision Records (ADRs)** under `docs/adr/`.

- Each ADR is a markdown file named `NNNN-kebab-title.md` with the next sequential,
  zero-padded number, created from [`template.md`](template.md).
- ADRs are **append-only and immutable once Accepted**: a superseded decision is
  never rewritten in place — a new ADR is added and the old one is marked
  "Superseded by ADR-XXXX".
- Statuses progress `Proposed` → `Accepted` → `Superseded` / `Deprecated`.
- An index in [`README.md`](README.md) lists every ADR; a row is **appended** for
  each new record.

## Consequences

- **Positive:** Durable rationale for decisions; a fast onboarding path for new
  sessions; directly supports the context-management workflow in `CLAUDE.md` by
  externalizing decisions to disk.
- **Negative:** Small per-decision overhead — writing and indexing an ADR.
- **Neutral:** Establishes a convention (numbering, statuses, index upkeep) that
  must be maintained consistently across sessions.

## Alternatives Considered

- **Capture decisions only in commit messages / PR descriptions.** Scattered and
  hard to browse; rationale gets buried in history and is awkward to supersede.
- **A single growing DECISIONS.md file.** Becomes large and merge-conflict-prone,
  and undermines the per-decision immutability we want.
- **No formal record.** Lowest overhead, but loses rationale across context resets —
  the exact problem we are solving.

## Supersedes / Superseded by

- Supersedes: none.
- Superseded by: none.
