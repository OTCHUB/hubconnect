// Mermaid.js source for the "HOW $HUB WORKS" mechanics page (MechanicsPanel.tsx). Kept as plain
// strings — no mermaid renderer is bundled (avoids a new client dependency); paste any block into
// mermaid.live or a Markdown host that renders Mermaid (GitHub, Notion, etc.) to view it graphically.
// Grounded in sdk/src/reader.ts (ConfigView/EpochView/DeskTierView) and docs/hubconnect-spec.md §A4-A7.

// Investor-facing overview — the deflationary loop in four steps, no technical detail.
export const CYCLE_DIAGRAM = `flowchart LR
    A["INITIAL BUY\\nGet a Desk NFT via otcdesks.cash\\n(mint on the launch curve or buy on secondary market)"] --> B["ACTIVATE\\nPay the Activation Cost\\nchoose your tier"]
    B --> C["EARN\\nDaily Rewards flow in\\nfrom Protocol Revenue"]
    C --> D["BURN\\nA slice of every reward round\\nbuys back & burns $HUB, forever"]
    D --> E["Supply shrinks\\nwhile activated desks keep earning"]
    E -.->|"scarcer supply supports value"| A
`;

export const ACTIVATION_DIAGRAM = `flowchart TD
    A["Desk owner holds Desk NFT\\n(Metaplex Core asset)"] --> B{"Choose payment leg"}
    B -->|SOL| C["activate_tier / upgrade_tier\\npay step fee (0.5 SOL/step)"]
    B -->|"$OTC @ 2.00x premium"| D["activate_tier_otc / upgrade_tier_otc\\notc_fee(step) -> POL reserve"]
    C --> E["90% -> Pot (round inflow, source A)\\n10% -> ops_wallet"]
    D --> F["100% -> [vault] PDA $OTC ATA\\nno pot / ops / round inflow"]
    E --> G["DeskTier PDA written\\ntier = current+1, activated_epoch = now\\nstamp_acc_per_weight = Config.acc_per_weight"]
    F --> G
    G --> H["Desk earns pro-rata yield\\nfrom every round closed after the stamp"]
    H --> I["claim_yield"]
    I --> J{"Lazy revocation:\\ncaller == on-chain owner right now?"}
    J -->|yes| K["Pay floor((acc_per_weight - stamp) x w / 1e12)\\nstamp := acc_per_weight"]
    J -->|no| L["voided = true, no refund\\ndesk drops out of Sigma w"]
    K --> H
    H --> M["upgrade_tier(_otc)"]
    M --> N["Pay only the step difference\\nsame ownership + stamp rules"]
    N --> G
    L --> O["Re-activation required\\n(full steps again)"]
`;

export const FEE_FLOW_DIAGRAM = `flowchart TD
    subgraph SOURCES["Pot inflow sources"]
        A1["A - Activation fees\\n0.45 / 0.90 / 1.35 / 1.80 SOL per step"]
        B1["B - Treasury desk yield\\nowned desks' desk-pot claims"]
        C1["C - Treasury OTC-stock claims\\nHUB float <=2% supply, pro-rata OTC -> pot"]
        D1["D - Discount-exit SOL leg\\n50% of every treasury desk sale"]
        E1["E - Consigned desks\\nowner-sent desks' desk-pot claims"]
        F1["F - LP swap fees\\nharvested HUB/SOL + HUB/OTC fees"]
    end
    A1 --> G["register_*_inflow\\nEpoch.inflow_lamports += amount"]
    B1 --> G
    C1 --> G
    D1 --> G
    E1 --> G
    F1 --> G
    G --> H{"inflow + dust_scaled carry\\n>= min_pot_threshold_lamports (0.1 SOL)?"}
    H -->|no, keep accumulating| G
    H -->|"yes - any time, no clock"| I["finalize_epoch"]
    I --> J["burn = floor(0.10 x round_inflow)\\n-> BurnState.burn_pending_lamports"]
    I --> K["distributable = round_inflow - burn"]
    K --> L["per_weight = floor(distributable x 1e12 / Sigma w)"]
    L --> M["Config.acc_per_weight += per_weight\\n(lifetime u128 accumulator)"]
    L --> N["remainder < 1 lamport -> Config.dust_scaled\\n(whole lamports re-enter next round)"]
    M --> O["Every activated DeskTier:\\nyield = floor((acc_per_weight - stamp_i) x w_i / 1e12)"]
    O --> P["claim_yield settles every round\\nclosed since the desk's stamp, one tx"]
    J --> Q["Buyback-burn keeper (see diagram 4)"]
`;

export const TREASURY_DIAGRAM = `flowchart TD
    subgraph ACQUIRE["Acquisition - sweep, never dilute"]
        A["sweep_cost = list_price x 1.07 (taker+royalty)\\nmint_cost = 100000 OTC-in-SOL + 0.5 SOL"]
        A --> B{"sweep_cost < mint_cost?"}
        B -->|"yes (current policy: always)"| C["Sweep on Magic Eden\\nverified non-empty vault stock only\\n<=10% treasury SOL per desk"]
        B -->|no| D["Mint (policy: never)\\ndilutes desk-pot, burns 100k OTC"]
        C --> E["TreasuryState.desks_owned += 1"]
    end
    subgraph CONSIGN["Voluntary consignment"]
        F["Owner calls consign_desk"] --> G["NFT -> treasury vault PDA\\nConsignedDesk{asset_id, consignor, epoch, active}"]
        G --> H["TreasuryState.desks_consigned += 1\\nowner keeps withdrawal right"]
        H --> H2["Guardrail: ConsignedDesk record blocks\\nany treasury transfer/sale - never in the exit pool"]
    end
    E --> I["Treasury claims OTC desk-pot rounds\\nfor every owned + consigned desk"]
    H --> I
    I --> J["register_treasury_inflow (source B)\\nregister_consigned_inflow (source E)"]
    J --> K{"consignor_share_bp > 0?\\n(default 0%)"}
    K -->|yes| L["credit consignor StakerAccrual.owed_lamports\\n(claim_accrual, claimable any time)"]
    K -->|"no (default)"| M["100% of desk proceeds -> pot inflow"]
    L --> M
    M --> N["Epoch.inflow_lamports rises\\n-> larger distributable each round\\n-> larger per_weight for every activated tier"]
    N --> O["Yield boost = shared pro-rata across\\nT1 1.00x / T2 1.25x / T3 1.60x / T4 2.00x\\n(no per-tier multiplier changes - just a bigger pool)"]
    E --> P["Discount exit"]
    P --> Q["sale_value = 0.90 x live floor\\nHUB leg 50% -> burned in sale tx\\nSOL leg 50% -> pot (source D)"]
    Q --> R["Sold to a non-treasury wallet\\n(one per wallet per exit window)"]
`;

export const BUYBACK_LP_DIAGRAM = `flowchart TD
    A["finalize_epoch: burn = floor(0.10 x round_inflow)"] --> B["BurnState.burn_pending_lamports += burn"]
    B --> C["Buyback-burn keeper (off-chain, spec M4)\\npolls burn_pending_lamports"]
    C --> D["Market-buy $HUB with pot SOL\\n(TWAP'd chunks, e.g. hourly slices)"]
    D --> E["spl-token Burn on the bought $HUB\\n(Mint.supply drop is the burn proof)"]
    E --> F["BurnState.total_hub_burned ledger += amount\\ndashboard flags 'drift' if ledger != Max-supply delta"]
    H["Treasury discount exit"] --> I["HUB leg = 50% of sale_value -> burned directly\\n(separate, immediate sink from the 10% pot burn)"]
    subgraph LP["LP building - HUB/SOL first, HUB/OTC as we grow"]
        J["Bonding-curve graduation (OTC launcher)"] --> K["Curve SOL + HUB migrate into a\\nprotocol-owned AMM pool - treasury seeds nothing"]
        K --> L{"Live impact within bounds?\\n5 SOL trade < ~5% impact,\\nhourly 10% burn chunk < ~1% impact"}
        L -->|yes| M["LP manager stays passive\\nharvest swap fees only"]
        L -->|no| N["Top-up: pair founding HUB allocation\\n+ treasury SOL (ops surplus)\\nnever market-buy HUB for LP"]
        M --> O["Harvested fees -> pot (source F)"]
        N --> O
        P{"HUB price stable >=14 days\\npost-launch?"} -->|yes| Q["Phase 2: open HUB/OTC pool\\nseed ~25-50 SOL-equivalent/side"]
        Q --> R["Pair treasury OTC (source C claims)\\n+ treasury HUB float (<=2% supply cap)"]
        R --> O
    end
    O --> S["Compounds staker yield\\n(source F feeds Epoch.inflow_lamports,\\nsame accumulator as diagram 2)"]
`;
