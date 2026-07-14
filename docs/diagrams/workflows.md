# Workflow & State Diagrams

## Stock Ledger — transaction lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> PendingApproval : submit (if approval required)
    Draft --> Posted : post (no approval needed)
    PendingApproval --> Approved : approver confirms
    PendingApproval --> Rejected : approver rejects
    Approved --> Posted : atomic post (ledger + balances)
    Posted --> Reversed : compensating entry (never edit)
    Rejected --> [*]
    Reversed --> [*]
    Posted --> [*]
    note right of Posted
        Posting is atomic and idempotent.
        Negative balance => Critical alert, never blocked if valid.
    end note
```

## Recycle-bin lifecycle

```mermaid
flowchart TD
    A["Authorized reasoned soft delete"] --> B["Set deleted/purge dates + append audit and command"]
    B --> C["30-day recycle-bin window"]
    C -->|Super Admin restores| D["Clear lifecycle dates + append audit and command"]
    C -->|Purge date reached| E{"Hold, inbound dependency, or ledger/accounting history?"}
    E -->|yes| F["Skip with safe blocked reason; preserve record"]
    E -->|no| G["Hard delete through guarded purge command"]
    G --> H["Keep independent audit evidence and purge result"]
```

## Backup status and recovery boundary

```mermaid
flowchart LR
    A["Secured external scheduler"] --> B["Encrypted backup + verification"]
    B --> C["Service-role metadata recorder"]
    C --> D["Super-Admin status/history UI"]
    B --> E["Human-approved scratch restore drill"]
    E --> F["Smoke tests + RTO evidence"]
    D -. "never executes restore" .-> E
```

## Notification condition and delivery

```mermaid
flowchart TD
    A["Operational producer observes condition"] --> B["Derive source severity and stable dedup key"]
    B --> C{"Active notification exists?"}
    C -->|yes| D["Update last raised and raise count"]
    C -->|no| E["Create active human-referenced notification"]
    D --> F["Append re-raised event"]
    E --> G["Append raised event"]
    F --> H["Ensure one in-app delivery per visible user"]
    G --> H
    H --> I{"Critical?"}
    I -->|no| J["Current alert remains visible until resolved"]
    I -->|yes| K["Queue one server-only email per recipient"]
    K --> L["Claim with token, send, finalize or retry"]
    L --> J
    J --> M["Read/ack changes own receipt and appends event"]
    M --> N["Resolution preserves history; a later recurrence creates a new active row"]
```

## Popup engagement reconciliation

```mermaid
stateDiagram-v2
    [*] --> Planned : create calendar-linked engagement
    Planned --> InProgress : start
    InProgress --> Reconciling : save balanced event count
    Reconciling --> Completed : validate linked posted movements and freeze summary
    Planned --> Cancelled : reasoned cancel
    InProgress --> Cancelled : reasoned cancel
    Completed --> [*]
    Cancelled --> [*]
    note right of InProgress
        Stock moves only through Phase 6 transfer/stock RPCs.
        The popup session links their posted effects.
    end note
    note right of Completed
        Completion checks arithmetic and ending zero.
        It never writes balance, lot, or ledger rows.
    end note
```

## Production workflow

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> SubmittedForApproval : submit
    SubmittedForApproval --> Approved : manager/super admin
    Approved --> InProgress : start (FEFO lots reserved)
    InProgress --> AwaitingOutputConfirmation : record actual inputs/outputs
    AwaitingOutputConfirmation --> Completed : confirm (atomic post)
    AwaitingOutputConfirmation --> PartiallyCompleted : confirm partial
    InProgress --> Failed : failure recorded
    Draft --> Cancelled
    SubmittedForApproval --> Cancelled
    Completed --> [*]
    PartiallyCompleted --> [*]
    Failed --> [*]
    Cancelled --> [*]
    note right of Completed
        Deduct inputs + add output + create lots +
        ledger entries in ONE transaction, or nothing.
        Exceptional variance requires Super Admin approval.
    end note
```

## Transfer workflow

```mermaid
stateDiagram-v2
    [*] --> Requested
    Requested --> Approved : Branch Mgr / Super Admin
    Approved --> Prepared : Main inventory staff picks
    Prepared --> InTransit : dispatched (stock leaves Main)
    InTransit --> Received : receiving branch counts + confirms
    Received --> Reconciled : discrepancies resolved
    Received --> DiscrepancyOpen : shortage/excess/damage
    DiscrepancyOpen --> Reconciled : reason + resolution
    Requested --> Cancelled
    Reconciled --> [*]
    Cancelled --> [*]
    note right of Received
        Receiving is idempotent — confirming twice
        does NOT add stock twice.
    end note
```

## Purchase receiving workflow

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted
    Submitted --> Approved : Super Admin (or delegated)
    Approved --> PartiallyReceived : receive delivery (accepted qty only)
    PartiallyReceived --> PartiallyReceived : further deliveries
    PartiallyReceived --> FullyReceived : all lines satisfied
    Approved --> FullyReceived : single full delivery
    FullyReceived --> Closed
    Draft --> Cancelled
    Submitted --> Cancelled
    Approved --> Cancelled
    Closed --> [*]
    Cancelled --> [*]
    note right of PartiallyReceived
        Only ACCEPTED quantities create stock-in +
        update weighted-average cost. Damaged/rejected/
        missing require review, not stock.
    end note
```

## Recount → compensating adjustment

```mermaid
flowchart TD
    A["Open start/end/cycle recount"] --> B["Freeze expected components and posted-cost snapshot"]
    B --> C["Draft: enter every physical count"]
    C --> D{"Physical - expected = 0?"}
    D -->|yes| E["Closed: no ledger movement"]
    D -->|no| F["Submitted: freeze variance and unusual signals"]
    F --> G{"Unusual?"}
    G -->|no| H["Inventory Staff or Branch Manager supplies reason"]
    G -->|yes| I["Super Admin supplies reason"]
    H --> J["Atomic recount_adjustment transaction"]
    I --> J
    J --> K["Append ledger + update balance/lots"]
    K --> L["Adjusted: prior posted rows remain unchanged"]
```

Expected quantity is frozen to four decimals as
`opening + received + production output - transfers out - usage - stock-outs - waste`. The
variance value and adjustment ledger line copy the frozen existing cost snapshot; no finalized cost
is recomputed.

## Day close → audited reopen

```mermaid
stateDiagram-v2
    [*] --> Open
    Open --> Closed : manager/super closes ready day
    Closed --> Closed : all stock/recount writes rejected
    Closed --> Reopened : Super Admin + required reason
    Reopened --> Reopened : later writes carry reopen event
    Reopened --> Closed : close again when ready
    note right of Open
        Close requires a terminal start-of-day recount
        and no draft/submitted recounts.
    end note
    note right of Reopened
        Reopen writes one append-only close event and audit row.
        Later ledger/recount rows link to that event explicitly.
    end note
```
