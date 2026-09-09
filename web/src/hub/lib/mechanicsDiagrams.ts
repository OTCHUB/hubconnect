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
    A["Desk owner holds Desk NFT\\n(Metaplex Core asset)"] --> B["activate_tier / upgrade_tier\\ntarget_tier (1..4)"]
    B --> C["Flat step fee: 0.5 SOL, every call\\n90% -> Pot (round inflow, source A)\\n10% -> ops_wallet"]
    C --> D{"Which leg pays the HUB burn?"}
    D -->|"SOL direct"| E["BurnChecked: burn cumulative\\ntier-cost delta (100k-200k HUB)"]
    D -->|"$OTC (activate_tier_otc / upgrade_tier_otc)"| F["otcSwapAmount sized off a live\\nJupiter OTC->HUB quote"]
    F --> G["Half: Jupiter swap OTC->HUB\\nmin_out = hubCostDelta, burned in full"]
    F --> H["Equal half: OTC -> desk-pot vault\\n(no swap - raises lifetime avg buy rate)"]
    E --> I["DeskTier PDA written\\ntier = target_tier, activated_epoch = now\\nstamp_acc_per_weight = Config.acc_per_weight"]
    G --> I
    H --> I
    I --> J["Desk earns pro-rata yield\\nfrom every round closed after the stamp"]
    J --> K["claim_yield"]
    K --> L{"Lazy revocation:\\ncaller == on-chain owner right now?"}
    L -->|yes| M["Pay floor((acc_per_weight - stamp) x w / 1e12)\\nstamp := acc_per_weight"]
    L -->|no| N["voided = true, no refund\\ndesk drops out of Sigma w"]
    M --> J
    N --> O["Re-activation required\\n(fee + burn again)"]
`;

export const FEE_FLOW_DIAGRAM = `flowchart TD
    subgraph SOURCES["Pot inflow sources"]
        A1["A - Activation fees\\n0.45 / 0.90 / 1.35 / 1.80 SOL per step"]
        B1["B - Treasury desk yield\\nowned desks' desk-pot claims"]
        C1["C - Treasury OTC-stock claims\\nHUB float <=2% supply, pro-rata OTC -> pot"]
        D1["D - Discount-exit SOL leg\\n50% of every treasury desk sale"]
        F1["F - LP swap fees\\nharvested HUB/SOL + HUB/OTC fees"]
    end
    A1 --> G["register_*_inflow\\nEpoch.inflow_lamports += amount"]
    B1 --> G
    C1 --> G
    D1 --> G
    F1 --> G
    G --> H{"inflow + dust_scaled carry\\n>= min_pot_threshold_lamports (0.1 SOL)?"}
    H -->|no, keep accumulating| G
    H -->|"yes - any time, no clock"| I["finalize_epoch"]
    I --> J["swap_leg = floor(0.10 x round_inflow)\\nsynchronous Jupiter CPI, SOL -> HUB"]
    J --> J2["HUB out split 50/25/25 in the same tx:\\n5% burn / 2.5% LP-pending / 2.5% treasury float\\n(float capped, excess burned - see diagram 4)"]
    I --> K["distributable = 0.90 x round_inflow"]
    K --> L["per_weight = floor(distributable x 1e12 / Sigma w)"]
    L --> M["Config.acc_per_weight += per_weight\\n(lifetime u128 accumulator)"]
    L --> N["remainder < 1 lamport -> Config.dust_scaled\\n(whole lamports re-enter next round)"]
    M --> O["Every activated DeskTier:\\nyield = floor((acc_per_weight - stamp_i) x w_i / 1e12)"]
    O --> P["claim_yield settles every round\\nclosed since the desk's stamp, one tx"]
`;

export const TREASURY_DIAGRAM = `flowchart TD
    subgraph ACQUIRE["Acquisition - sweep, never dilute"]
        A["sweep_cost = list_price x 1.07 (taker+royalty)\\nmint_cost = 100000 OTC-in-SOL + 0.5 SOL"]
        A --> B{"sweep_cost < mint_cost?"}
        B -->|"yes (current policy: always)"| C["Sweep on Magic Eden\\nverified non-empty vault stock only\\n<=10% treasury SOL per desk"]
        B -->|no| D["Mint (policy: never)\\ndilutes desk-pot, burns 100k OTC"]
        C --> E["TreasuryState.desks_owned += 1"]
    end
    E --> I["Treasury claims OTC desk-pot rounds\\nfor every owned desk"]
    I --> J["register_treasury_inflow (source B)"]
    J --> M["100% of desk proceeds -> pot inflow"]
    M --> N["Epoch.inflow_lamports rises\\n-> larger distributable each round\\n-> larger per_weight for every activated tier"]
    N --> O["Yield boost = shared pro-rata across\\nT1 1.00x / T2 1.25x / T3 1.60x / T4 2.00x\\n(no per-tier multiplier changes - just a bigger pool)"]
    E --> P["Discount exit"]
    P --> Q["sale_value = 0.90 x live floor\\nHUB leg 50% -> burned in sale tx\\nSOL leg 50% -> pot (source D)"]
    Q --> R["Sold to a non-treasury wallet\\n(one per wallet per exit window)"]
`;

export const BUYBACK_LP_DIAGRAM = `flowchart TD
    A["finalize_epoch: swap_leg = floor(0.10 x round_inflow)"] --> B["Synchronous Jupiter CPI, in the same tx\\nSOL -> HUB, min_out enforced by balance-delta"]
    B --> C["HUB out split 50/25/25, same tx:\\n5% burned / 2.5% LP-pending / 2.5% treasury float"]
    C --> D["BurnState.total_hub_burned += burn leg\\ndashboard flags 'drift' if ledger != Max-supply delta"]
    C --> E["TreasuryState.lp_pending_hub_units += LP leg\\n(phase-2 HUB/OTC LP build)"]
    C --> F["TreasuryState.treasury_float_units += float leg\\ncapped at hub_float_cap_bp (5%, admin-updatable)\\nexcess over the cap is burned instead"]
    G["Treasury discount exit"] --> H["HUB leg = 50% of sale_value -> burned directly\\n(separate, immediate sink from the round-split burn)"]
    subgraph LP["LP building - HUB/SOL first, HUB/OTC as we grow"]
        I["Bonding-curve graduation (OTC launcher)"] --> J["Curve SOL + HUB migrate into a\\nprotocol-owned AMM pool - treasury seeds nothing"]
        J --> K{"Live impact within bounds?\\n5 SOL trade < ~5% impact"}
        K -->|yes| L["LP manager stays passive\\nharvest swap fees only"]
        K -->|no| M["Top-up: pair founding HUB allocation\\n+ treasury SOL (ops surplus)\\nnever market-buy HUB for LP"]
        L --> N["Harvested fees -> pot (source F)"]
        M --> N
        O{"HUB price stable >=24h\\npost-launch (lp_phase2_open_ts)?"} -->|yes| P["Phase 2: open HUB/OTC pool\\nseed with lp_pending_hub_units + treasury OTC"]
        P --> Q["lock_cp_liquidity burns the LP mint outright\\ntreasury retains a permanent fee-claim right"]
        Q --> N
    end
    N --> R["Compounds staker yield\\n(source F feeds Epoch.inflow_lamports,\\nsame accumulator as diagram 2)"]
`;

// M.I.M ETF ("Magic Internet Money" ETF) — the on-chain/SDK name is HubPotConfig/HubPotRound;
// M.I.M ETF / "MemeStock Basket" is purely the front-end label (docs/hubconnect-spec.md SS A5.1,
// HubPotPanel.tsx). A secondary yield stream, entirely independent of the primary SOL desk-pot
// round in FEE_FLOW_DIAGRAM above — funded from the same treasury desks described in
// TREASURY_DIAGRAM, but paid out of its own 4-token basket rather than the SOL pot.
export const ETF_FLOW_DIAGRAM = `flowchart TD
    subgraph SRC["Treasury-owned desks — 13-stock desk-pot yield claimed every round"]
        NATIVE["4 native basket stocks\\n$OTC · CRCLx · OPENAI · ANTHROPIC\\n(MemeStock tickers native to OTC Desks\\n- NOT equity/shares in the real companies)"]
        EXTERNAL["9 external stocks\\nAAPLx · MSFTx · NVDAx · AMZNx · SPCXx\\nPOLYMARKET · KALSHI · NEURALINK · ANDURIL"]
    end

    subgraph SWAPPATH["Swap path - the 9 external stocks"]
        EXTERNAL --> SWAP["Swap to SOL\\n(Jupiter, slippage-capped)"]
        SWAP --> SPLIT["Equal Split (25% each)\\nacross the 4 basket buckets"]
        SPLIT --> CONV["Swap each 25% share\\nSOL -> its bucket token"]
    end

    subgraph DIRECTPATH["Direct path - the 4 native stocks"]
        NATIVE --> DIRECT["Pass straight through\\nbypasses the SOL swap entirely"]
    end

    CONV --> BASKET["fund_hub_pot\\n4x enforced TransferChecked into the\\nMemeStock Basket ($OTC/CRCLx/OPENAI/ANTHROPIC)"]
    DIRECT --> BASKET
    BASKET --> POT["HubPotConfig ['hub_pot']\\n4 vault-owned token accounts\\npending + lifetime totals per bucket"]
    POT --> ROUND["open_hub_pot_round (permissionless)\\nsnapshots all 4 pending balances x Sigma w"]
    ROUND --> DIST{"claim_hub_pot_reward (owner pulls)\\nor distribute_hub_pot_reward (authority pushes)"}
    DIST --> PAY["Pays tier-weighted share of all 4 buckets\\n(T1 1.00x / T2 1.25x / T3 1.60x / T4 2.00x)\\nto the desk's current owner, one tx"]
    PAY --> GUARD["HubPotClaim PDA per (round, desk)\\none-payout-per-desk-per-round guard, either path"]
    GUARD -.->|"independent secondary stream -\\nnever touches the primary SOL desk-pot round"| ROUND
`;
