# Wave Execution Plan — mcp-server-discord

**Approved:** 2026-04-06
**Repo:** Wave-Engineering/mcp-server-discord (+ Wave-Engineering/claudecode-workflow for W6)
**Platform:** GitHub (`gh` CLI)
**Epics:** #1 (Phase 1), #2 (Phase 2), #3 (Phase 3)
**wave-status initialized:** `.claude/status/` + `.status-panel.html`

---

## Wave Map

```
W1 ── #4  Foundation Scaffold
         │
W2 ── #5  Shared Modules
         │
W3 ─┬─ #6  disc_send
    ├─ #7  disc_read        (parallel)
    └─ #8  disc_resolve
         │
W4 ─┬─ #9  disc_list
    ├─ #10 disc_create_channel  (parallel)
    └─ #11 disc_create_thread
         │
W5 ── #12 MCP Wiring + IT-06
         │
W6 ── cw#278  claudecode-workflow integration
         │
W7 ─┬─ #13 E2E Tests + MV-01  (parallel)
    └─ #14 Docs Finalization
```

## Wave Details

| Wave | Issues | Parallel? | Depends On | Task |
|------|--------|-----------|------------|------|
| W1 | #4 | Single | — | Task #19 |
| W2 | #5 | Single | W1 | Task #20 |
| W3 | #6, #7, #8 | Yes | W2 | Task #21 |
| W4 | #9, #10, #11 | Yes | W2 | Task #22 |
| W5 | #12 | Single | W3+W4 | Task #23 |
| W6 | cw#278 | Single (cross-repo) | W5 | Task #24 |
| W7 | #13, #14 | Yes | W6 | Task #25 |

## Branch Convention

`feature/<issue-number>-<slug>` — created by `/nextwave` at execution time from current `main`.

## Notes

- W3 and W4 both depend on W2 and are independent of each other — can run concurrently
- W6 targets `claudecode-workflow` repo — `/nextwave` must be run from that repo for W6
- W7 story #13 (E2E tests) requires `DISCORD_INTEGRATION_TESTS=1` and a live Discord bot token
