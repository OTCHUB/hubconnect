/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/hub.json`.
 */
export type Hub = {
  "address": "7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i",
  "metadata": {
    "name": "hub",
    "version": "1.0.0",
    "spec": "0.1.0",
    "description": "$HUB Yield Optimizer Protocol — Activate-to-earn Boosted Yield layer for OTC desk NFTs on Solana"
  },
  "instructions": [
    {
      "name": "activateTier",
      "docs": [
        "§B3 #2 — fresh activation (or re-activation of a voided tier) straight into `target_tier`;",
        "flat `step_fee` SOL + the full $HUB cost of `target_tier`, burned."
      ],
      "discriminator": [
        2,
        202,
        143,
        147,
        26,
        29,
        231,
        192
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "deskAsset"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "config.currentEpoch",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "opsWallet",
          "writable": true
        },
        {
          "name": "hubMint",
          "writable": true
        },
        {
          "name": "payerHub",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "deskTier",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryLockVault",
          "docs": [
            "the 50%-of-cost \"reward\" leg of the tier-activation burn split lands here (see",
            "`Config.tier_cost_burn_bp`), same destination `fund_treasury_reward` uses."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "targetTier",
          "type": "u8"
        }
      ]
    },
    {
      "name": "activateTierOtc",
      "docs": [
        "§A4.1 #16 — `activate_tier` paid in $OTC at the 2× premium: `otc_swap_amount` swapped",
        "$OTC→$HUB via Jupiter (`min_out = hub_cost_delta`, burned in full) + an equal-scaled",
        "amount injected into the $OTC yield vault (`OtcPotState`, no swap)."
      ],
      "discriminator": [
        23,
        23,
        222,
        246,
        195,
        202,
        73,
        107
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "deskAsset"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "config.currentEpoch",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "opsWallet",
          "writable": true
        },
        {
          "name": "otcPay",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  97,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "payerOtc",
          "docs": [
            "desk-pot leg transfer and the Jupiter swap-burn leg (as part of `remaining_accounts`)."
          ],
          "writable": true
        },
        {
          "name": "otcPot",
          "docs": [
            "§A5 yield-vault bookkeeping; the desk-pot leg's `total_otc_bought_units` is credited here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcVault",
          "docs": [
            "the desk-pot leg (no swap — already $OTC)."
          ],
          "writable": true
        },
        {
          "name": "hubMint",
          "writable": true
        },
        {
          "name": "payerHub",
          "docs": [
            "destination; split burned/reward immediately after (see `tier_cost_burn_bp`)."
          ],
          "writable": true
        },
        {
          "name": "otcTokenProgram",
          "docs": [
            "`otc_mint`'s actual owner. $OTC and $HUB sit on *different* token programs ($OTC is",
            "Token-2022, $HUB is classic Token), so this instruction needs two distinct",
            "`token_program` accounts — see `hub_token_program` below — never one shared account."
          ]
        },
        {
          "name": "hubTokenProgram"
        },
        {
          "name": "jupiterProgram"
        },
        {
          "name": "deskTier",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryLockVault",
          "docs": [
            "the burn split lands here (mirrors `tiers.rs`'s SOL path, so paying in $OTC isn't",
            "structurally cheaper or more punitive)."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "targetTier",
          "type": "u8"
        },
        {
          "name": "otcSwapAmount",
          "type": "u64"
        },
        {
          "name": "jupiterData",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "buildLp",
      "docs": [
        "§B3 #13"
      ],
      "discriminator": [
        55,
        70,
        38,
        199,
        160,
        184,
        85,
        251
      ],
      "accounts": [
        {
          "name": "treasury",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "lpVault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "pair",
          "type": {
            "defined": {
              "name": "lpPair"
            }
          }
        },
        {
          "name": "hubAmount",
          "type": "u64"
        },
        {
          "name": "quoteAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buildLpBasketLocked",
      "docs": [
        "§A5.1 basket extension of `build_lp_otc_locked` — treasury-signed, seeds (or tops up)",
        "one of the three MemeStock basket pairs' (HUB/CRCLx, HUB/NVDAx, HUB/SPCXx) locked",
        "Raydium CP-Swap position."
      ],
      "discriminator": [
        60,
        84,
        55,
        236,
        15,
        172,
        54,
        117
      ],
      "accounts": [
        {
          "name": "treasury",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "deposit/lock authority — `invoke_signed` below elevates it to a signer via its seeds."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "pair",
          "type": {
            "defined": {
              "name": "lpPair"
            }
          }
        },
        {
          "name": "hubAmount",
          "type": "u64"
        },
        {
          "name": "quoteAmount",
          "type": "u64"
        },
        {
          "name": "lpTokenAmount",
          "type": "u64"
        },
        {
          "name": "depositAccountCount",
          "type": "u8"
        },
        {
          "name": "withMetadata",
          "type": "bool"
        }
      ]
    },
    {
      "name": "buildLpOtcLocked",
      "docs": [
        "§A6.2 phase-2 — Raydium CP-Swap `deposit` + `lock_cp_liquidity` for the HUB/OTC pair:",
        "deposits, then burns the LP mint in the same tx while retaining a permanent fee claim."
      ],
      "discriminator": [
        35,
        217,
        247,
        129,
        17,
        193,
        88,
        230
      ],
      "accounts": [
        {
          "name": "treasury",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "deposit/lock authority — `invoke_signed` below elevates it to a signer via its seeds."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "hubAmount",
          "type": "u64"
        },
        {
          "name": "otcAmount",
          "type": "u64"
        },
        {
          "name": "lpTokenAmount",
          "type": "u64"
        },
        {
          "name": "depositAccountCount",
          "type": "u8"
        },
        {
          "name": "withMetadata",
          "type": "bool"
        }
      ]
    },
    {
      "name": "claimAirdrop",
      "docs": [
        "§A7.1 #20 — a desk's current owner claims its snapshot allocation (one claim per asset)."
      ],
      "discriminator": [
        137,
        50,
        122,
        111,
        89,
        254,
        8,
        20
      ],
      "accounts": [
        {
          "name": "claimant",
          "writable": true,
          "signer": true
        },
        {
          "name": "deskAsset"
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "hubMint"
        },
        {
          "name": "airdropVault",
          "writable": true
        },
        {
          "name": "claimantHub",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "claim",
          "docs": [
            "Receipt — `init` (not `init_if_needed`) makes a second claim for the same desk fail."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  105,
                  114,
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountUnits",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "claimHubPotReward",
      "docs": [
        "§A5.1 #37 — a desk's current owner pulls its own tier-weighted share of all 4 open",
        "`HubPotRound` buckets (\"M.I.M ETF\" — $OTC/CRCLx/NVDAx/SPCXx), self-signed; shares the",
        "same `HubPotClaim` PDA as `distribute_hub_pot_reward` so a desk can only ever be paid once",
        "per round regardless of which path is used (mirrors `claim_airdrop`/`distribute_airdrop`)."
      ],
      "discriminator": [
        210,
        240,
        177,
        9,
        52,
        69,
        147,
        63
      ],
      "accounts": [
        {
          "name": "claimant",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deskAsset"
        },
        {
          "name": "deskTier",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "hubPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116,
                  95,
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "roundIndex"
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "crclxMint"
        },
        {
          "name": "nvdaxMint"
        },
        {
          "name": "spcxxMint"
        },
        {
          "name": "otcVault",
          "writable": true
        },
        {
          "name": "crclxVault",
          "writable": true
        },
        {
          "name": "nvdaxVault",
          "writable": true
        },
        {
          "name": "spcxxVault",
          "writable": true
        },
        {
          "name": "claimantOtc",
          "writable": true
        },
        {
          "name": "claimantCrclx",
          "writable": true
        },
        {
          "name": "claimantNvdax",
          "writable": true
        },
        {
          "name": "claimantSpcxx",
          "writable": true
        },
        {
          "name": "otcTokenProgram",
          "docs": [
            "actual owner. One `token_program` account per bucket (see `FundHubPot`'s doc comment for",
            "why a single shared account isn't safe once `update_hub_pot_mint` can move a bucket to a",
            "mint on a different token program)."
          ]
        },
        {
          "name": "crclxTokenProgram"
        },
        {
          "name": "nvdaxTokenProgram"
        },
        {
          "name": "spcxxTokenProgram"
        },
        {
          "name": "claim",
          "docs": [
            "Same seeds as `DistributeHubPotReward::claim` — pull and push share one PDA per",
            "(round, desk asset), so a desk can only ever be paid once regardless of which path is used."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "arg",
                "path": "roundIndex"
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "roundIndex",
          "type": "u32"
        }
      ]
    },
    {
      "name": "claimYield",
      "docs": [
        "§B3 #5 (lazy revocation → #8 void_tier). One tx settles every closed round."
      ],
      "discriminator": [
        49,
        74,
        111,
        7,
        186,
        22,
        61,
        165
      ],
      "accounts": [
        {
          "name": "claimer",
          "writable": true,
          "signer": true
        },
        {
          "name": "deskAsset"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deskTier",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcPot",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "otcVault",
          "writable": true
        },
        {
          "name": "claimerOtc",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "`otc_mint`'s actual owner."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "clearCreatorFees",
      "docs": [
        "§A6.3 #25 — permissionless: splits the pending balance 80/5/5/5/5 once it clears the",
        "threshold; the 80% desk-pot leg is injected into `OtcPotState` in the same instruction."
      ],
      "discriminator": [
        98,
        193,
        114,
        81,
        91,
        60,
        141,
        246
      ],
      "accounts": [
        {
          "name": "creatorFeeState",
          "docs": [
            "Permissionless: the split is deterministic bp math, like `finalize_epoch`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  95,
                  102,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "otcPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "creatorFeeVault",
          "writable": true
        },
        {
          "name": "otcVault",
          "writable": true
        },
        {
          "name": "pot",
          "docs": [
            "token accounts are owned by this PDA — same custody design as `otc_vault`)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "`transfer_checked`."
          ]
        }
      ],
      "args": []
    },
    {
      "name": "compoundLpBasket",
      "docs": [
        "§A5.1 basket sibling of `compound_lp_otc` — permissionless, uncapped, deposits the",
        "entire `TreasuryState.lp_basket_pending_hub_units[pair]` earmark (fed by",
        "`harvest_lp_fees`, not `finalize_epoch`) once it clears `LP_COMPOUND_MIN_HUB_UNITS`."
      ],
      "discriminator": [
        226,
        106,
        155,
        126,
        166,
        68,
        62,
        96
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "Permissionless — no `has_one` check, mirrors `compound_lp_otc`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "pair",
          "type": {
            "defined": {
              "name": "lpPair"
            }
          }
        },
        {
          "name": "quoteAmount",
          "type": "u64"
        },
        {
          "name": "lpTokenAmount",
          "type": "u64"
        },
        {
          "name": "depositAccountCount",
          "type": "u8"
        },
        {
          "name": "withMetadata",
          "type": "bool"
        }
      ]
    },
    {
      "name": "compoundLpOtc",
      "docs": [
        "§A6.2 phase-2 auto-compounder — permissionless: deposits the *entire*",
        "`TreasuryState.lp_pending_hub_units` earmark every call (uncapped — locked forever, only",
        "ever grows). Any keeper may call it once the pending earmark clears",
        "`LP_COMPOUND_MIN_HUB_UNITS`."
      ],
      "discriminator": [
        180,
        153,
        192,
        78,
        101,
        111,
        250,
        161
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "Permissionless — no `has_one` check, mirrors `FinalizeEpoch { keeper: Signer }`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "hubMint",
          "docs": [
            "stability, see doc comment above)."
          ],
          "writable": true
        },
        {
          "name": "vaultHub",
          "docs": [
            "deposit source below."
          ],
          "writable": true
        },
        {
          "name": "burn",
          "docs": [
            "Unused (no burn leg) — kept for account-list stability, see doc comment above."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  114,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "otcAmount",
          "type": "u64"
        },
        {
          "name": "lpTokenAmount",
          "type": "u64"
        },
        {
          "name": "depositAccountCount",
          "type": "u8"
        },
        {
          "name": "withMetadata",
          "type": "bool"
        }
      ]
    },
    {
      "name": "distributeAirdrop",
      "docs": [
        "§A7.1 #20b — authority pushes a snapshot allocation straight to the desk's current owner",
        "(genesis \"1-time 1-address\" distribution); shares the same `AirdropClaim` PDA guard as",
        "`claim_airdrop`, so a desk can only ever be paid once regardless of the path used."
      ],
      "discriminator": [
        208,
        4,
        12,
        36,
        180,
        28,
        118,
        225
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deskAsset",
          "docs": [
            "them, this is a push. Whoever holds the desk right now receives the payout, matching the",
            "genesis policy of paying \"the OTC desk NFT owner at distribution time.\""
          ]
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "hubMint"
        },
        {
          "name": "airdropVault",
          "writable": true
        },
        {
          "name": "ownerHub",
          "docs": [
            "actual on-chain owner in the handler, not against a signer."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "claim",
          "docs": [
            "Same seeds as `ClaimAirdrop::claim` — `init` makes a second payout for the same desk fail",
            "regardless of whether the first one went through `claim_airdrop` or `distribute_airdrop`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  105,
                  114,
                  100,
                  114,
                  111,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountUnits",
          "type": "u64"
        },
        {
          "name": "proof",
          "type": {
            "vec": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "distributeHubPotReward",
      "docs": [
        "§A5.1 #36 — authority pushes one active desk's tier-weighted share of all 4 open",
        "`HubPotRound` buckets straight to its current owner in a single transaction (4",
        "`transfer_checked` CPIs); each bucket independently capped so it can never pay out more",
        "than that bucket's snapshotted amount."
      ],
      "discriminator": [
        45,
        241,
        217,
        255,
        166,
        70,
        119,
        55
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deskAsset",
          "docs": [
            "`distribute_treasury_reward`'s \"pay whoever holds the desk right now\" policy."
          ]
        },
        {
          "name": "deskTier",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "hubPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116,
                  95,
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "roundIndex"
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "crclxMint"
        },
        {
          "name": "nvdaxMint"
        },
        {
          "name": "spcxxMint"
        },
        {
          "name": "otcVault",
          "writable": true
        },
        {
          "name": "crclxVault",
          "writable": true
        },
        {
          "name": "nvdaxVault",
          "writable": true
        },
        {
          "name": "spcxxVault",
          "writable": true
        },
        {
          "name": "ownerOtc",
          "docs": [
            "on-chain owner in the handler, not against a signer."
          ],
          "writable": true
        },
        {
          "name": "ownerCrclx",
          "writable": true
        },
        {
          "name": "ownerNvdax",
          "writable": true
        },
        {
          "name": "ownerSpcxx",
          "writable": true
        },
        {
          "name": "otcTokenProgram",
          "docs": [
            "actual owner. One `token_program` account per bucket (see `FundHubPot`'s doc comment for",
            "why a single shared account isn't safe once `update_hub_pot_mint` can move a bucket to a",
            "mint on a different token program)."
          ]
        },
        {
          "name": "crclxTokenProgram"
        },
        {
          "name": "nvdaxTokenProgram"
        },
        {
          "name": "spcxxTokenProgram"
        },
        {
          "name": "claim",
          "docs": [
            "One payout per desk asset per round."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "arg",
                "path": "roundIndex"
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "roundIndex",
          "type": "u32"
        }
      ]
    },
    {
      "name": "distributeTreasuryReward",
      "docs": [
        "#32 — authority pushes one active desk's tier-weighted share of an open `RewardRound`",
        "straight to its current owner; capped so a round can never pay out more than it holds."
      ],
      "discriminator": [
        152,
        54,
        132,
        121,
        78,
        212,
        250,
        48
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "deskAsset",
          "docs": [
            "`distribute_airdrop`'s \"pay whoever holds the desk right now\" policy."
          ]
        },
        {
          "name": "deskTier",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "arg",
                "path": "roundIndex"
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "hubMint"
        },
        {
          "name": "treasuryLockVault",
          "writable": true
        },
        {
          "name": "ownerHub",
          "docs": [
            "actual on-chain owner in the handler, not against a signer."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "claim",
          "docs": [
            "One payout per desk asset per round."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "arg",
                "path": "roundIndex"
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "roundIndex",
          "type": "u32"
        }
      ]
    },
    {
      "name": "drawCreatorFeeLeg",
      "docs": [
        "§A6.3 #26 — keeper draws a leg's earmarked $OTC to execute its off-chain swap."
      ],
      "discriminator": [
        178,
        119,
        195,
        44,
        43,
        159,
        177,
        69
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "creatorFeeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  95,
                  102,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "creatorFeeVault",
          "writable": true
        },
        {
          "name": "keeperOtc",
          "writable": true
        },
        {
          "name": "pot",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "`transfer_checked`."
          ]
        }
      ],
      "args": [
        {
          "name": "leg",
          "type": {
            "defined": {
              "name": "creatorFeeLeg"
            }
          }
        },
        {
          "name": "otcAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalizeEpoch",
      "docs": [
        "§B3 #4 / §A5 4-way split — 90% distributed to desks (unchanged mechanic); the other 10%",
        "(5% burn / 2.5% LP / 2.5% treasury float) is swapped SOL→$HUB via a two-hop synchronous",
        "Jupiter CPI executed inside this instruction: hop1 WSOL→USDC, hop2 USDC→$HUB. `ctx",
        ".remaining_accounts[..hop1_account_count]`/`hop1_data` are hop1's caller-assembled route;",
        "the remainder of `remaining_accounts`/`hop2_data` are hop2's (see",
        "`jupiter_swap::swap_exact_in`). `min_usdc_out`/`min_hub_out` floor each hop's output. The",
        "realized USDC/HUB rate this observes also refreshes `Config.tier_hub_cost_units_cached`",
        "when `sol_swapped_lamports` clears `PRICE_UPDATE_MIN_SOL_LAMPORTS` (see `epochs.rs`)."
      ],
      "discriminator": [
        159,
        93,
        117,
        217,
        63,
        44,
        249,
        76
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "Permissionless: the math is deterministic, so anyone may close a round once the",
            "threshold is met (they pay the next Epoch account's rent and assemble the Jupiter route)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "arg",
                "path": "epochIndex"
              }
            ]
          }
        },
        {
          "name": "nextEpoch",
          "writable": true
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "burn",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  114,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "otcPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "hubMint",
          "writable": true
        },
        {
          "name": "vaultWsol",
          "writable": true
        },
        {
          "name": "vaultUsdc",
          "docs": [
            "(USDC→$HUB) source; the intermediate leg of the two-hop price-discovery swap."
          ],
          "writable": true
        },
        {
          "name": "vaultHub",
          "docs": [
            "`lp_pending_hub_units`'s physical custody."
          ],
          "writable": true
        },
        {
          "name": "treasuryFloatVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "jupiterProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "epochIndex",
          "type": "u64"
        },
        {
          "name": "minUsdcOut",
          "type": "u64"
        },
        {
          "name": "minHubOut",
          "type": "u64"
        },
        {
          "name": "hop1AccountCount",
          "type": "u16"
        },
        {
          "name": "hop1Data",
          "type": "bytes"
        },
        {
          "name": "hop2Data",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "fundHubPot",
      "docs": [
        "§A5.1 #34 — treasury deposits the 4 already-converted basket amounts (swapped off-chain",
        "from source-B's 13-stock treasury-desk claim) in one instruction — four enforced",
        "`TransferChecked` deposits, not merely attested."
      ],
      "discriminator": [
        180,
        102,
        46,
        137,
        225,
        48,
        88,
        77
      ],
      "accounts": [
        {
          "name": "treasury",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "hubPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "crclxMint"
        },
        {
          "name": "nvdaxMint"
        },
        {
          "name": "spcxxMint"
        },
        {
          "name": "treasuryOtc",
          "writable": true
        },
        {
          "name": "treasuryCrclx",
          "writable": true
        },
        {
          "name": "treasuryNvdax",
          "writable": true
        },
        {
          "name": "treasurySpcxx",
          "writable": true
        },
        {
          "name": "otcVault",
          "writable": true
        },
        {
          "name": "crclxVault",
          "writable": true
        },
        {
          "name": "nvdaxVault",
          "writable": true
        },
        {
          "name": "spcxxVault",
          "writable": true
        },
        {
          "name": "opsOtc",
          "docs": [
            "ATA (mint/owner verified in handler), same 10% carve-out as `register_treasury_inflow`."
          ],
          "writable": true
        },
        {
          "name": "opsCrclx",
          "writable": true
        },
        {
          "name": "opsNvdax",
          "writable": true
        },
        {
          "name": "opsSpcxx",
          "writable": true
        },
        {
          "name": "otcTokenProgram",
          "docs": [
            "actually owned by after a future `update_hub_pot_mint`), asserted in `transfer_checked`.",
            "This instruction moves all 4 buckets in one call, and `update_hub_pot_mint` can move any",
            "single bucket to a mint on a different token program without touching the other three, so",
            "each bucket gets its own `token_program` account rather than one shared account."
          ]
        },
        {
          "name": "crclxTokenProgram"
        },
        {
          "name": "nvdaxTokenProgram"
        },
        {
          "name": "spcxxTokenProgram"
        }
      ],
      "args": [
        {
          "name": "otcAmount",
          "type": "u64"
        },
        {
          "name": "crclxAmount",
          "type": "u64"
        },
        {
          "name": "nvdaxAmount",
          "type": "u64"
        },
        {
          "name": "spcxxAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundTreasuryReward",
      "docs": [
        "§A6.3/§A7.1 bridge #30 — treasury deposits $HUB (swapped off-chain from the OTC launcher's",
        "holders-in-stock reward leg) into `treasury_lock_vault` (enforced deposit), earmarked for",
        "the next `open_reward_round`."
      ],
      "discriminator": [
        97,
        112,
        5,
        61,
        115,
        152,
        136,
        53
      ],
      "accounts": [
        {
          "name": "treasury",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "hubMint"
        },
        {
          "name": "treasuryHub",
          "writable": true
        },
        {
          "name": "treasuryLockVault",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "hubAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "harvestLpFees",
      "docs": [
        "§A5.1/§A6.2 yield leg — permissionless harvest of a locked position's accrued Raydium",
        "CP-Swap trading fees. The HUB-side leg feeds back into `pair`'s own pending compounding",
        "earmark; the quote-side leg (OTC/CRCLx/NVDAx/SPCXx) is credited straight",
        "into `HubPotConfig`'s matching bucket, routing real yield back to desk-holders."
      ],
      "discriminator": [
        153,
        236,
        19,
        193,
        135,
        211,
        138,
        173
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "Permissionless — no `has_one` check, mirrors `compound_lp_otc`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "hubPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "for the harvest CPI below via its seeds."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultHub",
          "docs": [
            "read before/after to learn the harvested amount (same account `finalize_epoch` /",
            "`compound_lp_otc` already use as `lp_pending_hub_units`' physical custody)."
          ],
          "writable": true
        },
        {
          "name": "quoteVault",
          "docs": [
            "mint this `pair` corresponds to (checked in the handler, since which field depends on",
            "the `pair` argument, not resolvable in an `#[account(address = ...)]` constraint alone)."
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "pair",
          "type": {
            "defined": {
              "name": "lpPair"
            }
          }
        }
      ]
    },
    {
      "name": "initCreatorFeeState",
      "docs": [
        "§A6.3 #23 — authority creates the creator-fee flywheel bookkeeping (one-time, post-init)."
      ],
      "discriminator": [
        104,
        118,
        233,
        238,
        35,
        9,
        16,
        44
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "creatorFeeVault"
        },
        {
          "name": "creatorFeeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  95,
                  102,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "keeper",
          "type": "pubkey"
        },
        {
          "name": "clearThresholdUnits",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initHubPot",
      "docs": [
        "§A5.1 #33 — authority creates the HUB Pot MemeStock basket bookkeeping (one-time,",
        "post-init); records the 4 basket mints (resolved at call time, never hardcoded) + their",
        "vault-owned token accounts."
      ],
      "discriminator": [
        32,
        247,
        252,
        50,
        58,
        40,
        189,
        252
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcVault"
        },
        {
          "name": "crclxVault"
        },
        {
          "name": "nvdaxVault"
        },
        {
          "name": "spcxxVault"
        },
        {
          "name": "hubPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "otcMint",
          "type": "pubkey"
        },
        {
          "name": "crclxMint",
          "type": "pubkey"
        },
        {
          "name": "nvdaxMint",
          "type": "pubkey"
        },
        {
          "name": "spcxxMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initOtcPayments",
      "docs": [
        "§A4.1 #14 — authority creates the $OTC payment config + POL reserve pointer (disabled)."
      ],
      "discriminator": [
        234,
        164,
        177,
        91,
        233,
        164,
        77,
        73
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "polAccount"
        },
        {
          "name": "otcPay",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  97,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initOtcPot",
      "docs": [
        "§A5 #21 — authority creates the $OTC yield-vault bookkeeping (one-time, post-init)."
      ],
      "discriminator": [
        28,
        212,
        254,
        124,
        34,
        208,
        20,
        248
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "otcVault"
        },
        {
          "name": "otcPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "keeper",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "initTokenomics",
      "docs": [
        "§A7.1 #18 — authority records the supply plan + the vault $HUB account funding the airdrop."
      ],
      "discriminator": [
        125,
        28,
        250,
        57,
        123,
        233,
        118,
        231
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "airdropVault"
        },
        {
          "name": "treasuryLockVault",
          "docs": [
            "holds the immutable 2% genesis floor; no instruction in this program ever debits it."
          ]
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initTreasuryFloat",
      "docs": [
        "§A6.3/§A7.1 bridge — authority records the vault-owned WSOL scratch, $HUB scratch, and",
        "$HUB buy-and-hold float ATAs `finalize_epoch`'s synchronous Jupiter legs need (one-time,",
        "post-init, mirrors `init_otc_pot`)."
      ],
      "discriminator": [
        81,
        231,
        116,
        124,
        179,
        180,
        125,
        59
      ],
      "accounts": [
        {
          "name": "treasury",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "vaultWsol"
        },
        {
          "name": "vaultUsdc"
        },
        {
          "name": "vaultHub"
        },
        {
          "name": "treasuryFloatVault"
        }
      ],
      "args": []
    },
    {
      "name": "initializeConfig",
      "docs": [
        "§B3 #1"
      ],
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "burn",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  114,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "epoch0",
          "docs": [
            "Genesis epoch — the open epoch must always exist (§B3 #4 roll-forward chain)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "initializeConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "openHubPotRound",
      "docs": [
        "§A5.1 #35 — permissionless: snapshots all 4 pending bucket balances across the live Σw",
        "of active desks into a new `HubPotRound`."
      ],
      "discriminator": [
        65,
        162,
        128,
        220,
        209,
        242,
        112,
        42
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Permissionless: deterministic snapshot, like `open_reward_round`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "hubPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116,
                  95,
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "hubPot.roundCount",
                "account": "hubPotConfig"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openRewardRound",
      "docs": [
        "#31 — permissionless: snapshots the pending reward deposit across the live Σw of active",
        "desks into a new `RewardRound`."
      ],
      "discriminator": [
        162,
        249,
        119,
        227,
        253,
        100,
        177,
        212
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Permissionless: deterministic snapshot, like `clear_creator_fees` / `finalize_epoch`."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "round",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  114,
                  111,
                  117,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "tokenomics.rewardRoundCount",
                "account": "tokenomicsConfig"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "pause",
      "docs": [
        "§B3 #10"
      ],
      "discriminator": [
        211,
        22,
        221,
        251,
        74,
        121,
        193,
        47
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "recordCreatorFee",
      "docs": [
        "§A6.3 #24 — treasury deposits its claimed launcher holder-leg $OTC (enforced deposit)."
      ],
      "discriminator": [
        201,
        63,
        201,
        9,
        42,
        210,
        100,
        176
      ],
      "accounts": [
        {
          "name": "treasury",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "creatorFeeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  95,
                  102,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "treasuryOtc",
          "writable": true
        },
        {
          "name": "creatorFeeVault",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "docs": [
            "program actually owns `otc_mint`), asserted in `transfer_checked`."
          ]
        }
      ],
      "args": [
        {
          "name": "otcReceived",
          "type": "u64"
        }
      ]
    },
    {
      "name": "recordCreatorFeeBurnResult",
      "docs": [
        "§A6.3 #27 — attests a burn executed off-chain from a drawn `Burn` leg."
      ],
      "discriminator": [
        83,
        158,
        18,
        235,
        45,
        168,
        119,
        143
      ],
      "accounts": [
        {
          "name": "keeper",
          "signer": true
        },
        {
          "name": "creatorFeeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  95,
                  102,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "burn",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  114,
                  110
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "otcSpent",
          "type": "u64"
        },
        {
          "name": "hubBurned",
          "type": "u64"
        },
        {
          "name": "burnTx",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "recordCreatorFeeOps",
      "docs": [
        "§A6.3 #29 — enforced: keeper's post-swap SOL lands in `ops_wallet` in the same tx."
      ],
      "discriminator": [
        3,
        64,
        47,
        36,
        131,
        31,
        209,
        122
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "creatorFeeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  95,
                  102,
                  101,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "opsWallet",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "otcSpent",
          "type": "u64"
        },
        {
          "name": "solAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "recordCreatorFeeStack",
      "docs": [
        "§A6.3 #28 — attests $HUB stacked into the treasury float from a drawn `Stack` leg."
      ],
      "discriminator": [
        44,
        16,
        251,
        155,
        60,
        94,
        33,
        133
      ],
      "accounts": [
        {
          "name": "keeper",
          "signer": true
        },
        {
          "name": "creatorFeeState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  95,
                  102,
                  101,
                  101
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "otcSpent",
          "type": "u64"
        },
        {
          "name": "hubAmount",
          "type": "u64"
        },
        {
          "name": "stackTx",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "recordOtcBuy",
      "docs": [
        "§A5 #22 — keeper-attested $OTC buy, reimbursed from the pot up to `otc_pending_lamports`."
      ],
      "discriminator": [
        154,
        87,
        58,
        88,
        244,
        225,
        16,
        69
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "Must be `otc_pot.authority`: fronts SOL for the market buy, reimbursed here on proof of",
            "deposit (the deposit itself is enforced on-chain below, not merely attested)."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "otcPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "keeperOtc",
          "writable": true
        },
        {
          "name": "otcVault",
          "writable": true
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "docs": [
            "actually owned by — $OTC is Token-2022), asserted in `transfer_checked`."
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "otcBought",
          "type": "u64"
        },
        {
          "name": "lamportsSpent",
          "type": "u64"
        },
        {
          "name": "buyTx",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        }
      ]
    },
    {
      "name": "registerTreasuryInflow",
      "docs": [
        "§B3 #6"
      ],
      "discriminator": [
        47,
        132,
        148,
        203,
        46,
        53,
        223,
        90
      ],
      "accounts": [
        {
          "name": "treasury",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "config.currentEpoch",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "opsWallet",
          "docs": [
            "address so a caller cannot redirect the skim anywhere else."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "source",
          "type": {
            "defined": {
              "name": "inflowSource"
            }
          }
        },
        {
          "name": "lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "setAirdropRoot",
      "docs": [
        "§A7.1 #19 — authority publishes the desk-snapshot Merkle root and opens/closes claims."
      ],
      "discriminator": [
        207,
        153,
        120,
        152,
        60,
        73,
        58,
        211
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "root",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "deskCount",
          "type": "u32"
        },
        {
          "name": "open",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setOtcPaymentsEnabled",
      "docs": [
        "§A4.1 #15 — authority toggles the $OTC payment path on/off. Pricing is a live Jupiter",
        "quote supplied per-call (`otc_swap_amount`), not a stored rate."
      ],
      "discriminator": [
        208,
        123,
        148,
        250,
        195,
        94,
        48,
        214
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "otcPay",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  97,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setTreasuryFloatCapBp",
      "docs": [
        "§A6.3/§A7.1 bridge — treasury multisig retunes the experimental treasury-float cap",
        "(bp of $HUB max supply). Excess over the live cap at deposit time is burned, never",
        "rejected."
      ],
      "discriminator": [
        97,
        179,
        121,
        199,
        122,
        82,
        185,
        165
      ],
      "accounts": [
        {
          "name": "treasury",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "hubFloatCapBp",
          "type": "u16"
        }
      ]
    },
    {
      "name": "unpause",
      "docs": [
        "§B3 #10"
      ],
      "discriminator": [
        169,
        144,
        4,
        38,
        10,
        141,
        188,
        255
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "docs": [
        "§B3 #9"
      ],
      "discriminator": [
        29,
        158,
        252,
        191,
        10,
        83,
        219,
        99
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "field",
          "type": {
            "defined": {
              "name": "configField"
            }
          }
        },
        {
          "name": "value",
          "type": {
            "defined": {
              "name": "configValue"
            }
          }
        }
      ]
    },
    {
      "name": "updateHubPotMint",
      "docs": [
        "§A5.1 — authority-only: swaps one HUB Pot bucket's backing mint + vault (e.g. rotating a",
        "synthetic pre-IPO token out for a directly-backed xStock RWA once its post-listing",
        "deviation risk is reassessed). Requires the bucket's pending balance to be zero first;",
        "any dust already sitting in the old vault is swept to `ops_wallet` rather than blocking."
      ],
      "discriminator": [
        139,
        74,
        201,
        188,
        93,
        136,
        20,
        169
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "the handler), and signs the dust-sweep transfer below."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "hubPot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  117,
                  98,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "oldMint",
          "docs": [
            "read only for `TransferChecked` decimals on the dust sweep below."
          ]
        },
        {
          "name": "oldVault",
          "docs": [
            "any residual balance is swept to `sweep_dest` before the swap is recorded, so nothing is",
            "stranded once `hub_pot` stops pointing at it."
          ],
          "writable": true
        },
        {
          "name": "sweepDest",
          "docs": [
            "any leftover `old_vault` balance; only touched when that balance is non-zero."
          ],
          "writable": true
        },
        {
          "name": "newVault",
          "docs": [
            "created off-chain ahead of time, same pattern as `init_hub_pot`'s bucket vaults."
          ]
        },
        {
          "name": "tokenProgram",
          "docs": [
            "one `old_mint` is actually owned by — asserted in `transfer_checked`. Only ever touches",
            "one bucket's mint per call, so a single dynamically-validated account suffices here",
            "(unlike `FundHubPot`/`DistributeHubPotReward`/`ClaimHubPotReward`, which move all 4",
            "buckets in one instruction and so need one `token_program` account per bucket)."
          ]
        }
      ],
      "args": [
        {
          "name": "bucket",
          "type": {
            "defined": {
              "name": "hubPotBucket"
            }
          }
        },
        {
          "name": "newMint",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "upgradeTier",
      "docs": [
        "§B3 #3 — flat `step_fee` SOL (never scales with the step size) + the $HUB cost",
        "difference for `current → target_tier`, burned."
      ],
      "discriminator": [
        122,
        56,
        170,
        60,
        252,
        234,
        190,
        51
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "deskAsset"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "config.currentEpoch",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "opsWallet",
          "writable": true
        },
        {
          "name": "hubMint",
          "writable": true
        },
        {
          "name": "payerHub",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "deskTier",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryLockVault",
          "docs": [
            "the 50%-of-cost \"reward\" leg of the tier-upgrade burn split lands here (see",
            "`Config.tier_cost_burn_bp`), same destination `fund_treasury_reward` uses."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "targetTier",
          "type": "u8"
        }
      ]
    },
    {
      "name": "upgradeTierOtc",
      "docs": [
        "§A4.1 #17 — `upgrade_tier` paid in $OTC at the 2× premium (see `activate_tier_otc`)."
      ],
      "discriminator": [
        6,
        67,
        172,
        88,
        159,
        216,
        216,
        108
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "deskAsset"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "config.currentEpoch",
                "account": "config"
              }
            ]
          }
        },
        {
          "name": "pot",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "opsWallet",
          "writable": true
        },
        {
          "name": "otcPay",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  97,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "otcMint"
        },
        {
          "name": "payerOtc",
          "docs": [
            "desk-pot leg transfer and the Jupiter swap-burn leg (as part of `remaining_accounts`)."
          ],
          "writable": true
        },
        {
          "name": "otcPot",
          "docs": [
            "§A5 yield-vault bookkeeping; the desk-pot leg's `total_otc_bought_units` is credited here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  116,
                  99,
                  95,
                  112,
                  111,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "otcVault",
          "docs": [
            "the desk-pot leg (no swap — already $OTC)."
          ],
          "writable": true
        },
        {
          "name": "hubMint",
          "writable": true
        },
        {
          "name": "payerHub",
          "docs": [
            "destination; split burned/reward immediately after (see `tier_cost_burn_bp`)."
          ],
          "writable": true
        },
        {
          "name": "otcTokenProgram",
          "docs": [
            "`otc_mint`'s actual owner. See `ActivateTierOtc`'s doc comment on why $OTC and $HUB need",
            "two distinct `token_program` accounts here."
          ]
        },
        {
          "name": "hubTokenProgram"
        },
        {
          "name": "jupiterProgram"
        },
        {
          "name": "deskTier",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deskAsset"
              }
            ]
          }
        },
        {
          "name": "tokenomics",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  111,
                  107,
                  101,
                  110,
                  111,
                  109,
                  105,
                  99,
                  115
                ]
              }
            ]
          }
        },
        {
          "name": "treasuryLockVault",
          "docs": [
            "the burn split lands here (mirrors `tiers.rs`'s SOL path)."
          ],
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "targetTier",
          "type": "u8"
        },
        {
          "name": "otcSwapAmount",
          "type": "u64"
        },
        {
          "name": "jupiterData",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "airdropClaim",
      "discriminator": [
        231,
        12,
        74,
        54,
        245,
        181,
        248,
        38
      ]
    },
    {
      "name": "burnState",
      "discriminator": [
        21,
        157,
        214,
        236,
        176,
        133,
        70,
        52
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "creatorFeeState",
      "discriminator": [
        165,
        45,
        232,
        107,
        87,
        2,
        213,
        109
      ]
    },
    {
      "name": "deskTier",
      "discriminator": [
        13,
        102,
        197,
        1,
        133,
        89,
        205,
        199
      ]
    },
    {
      "name": "epoch",
      "discriminator": [
        93,
        83,
        120,
        89,
        151,
        138,
        152,
        108
      ]
    },
    {
      "name": "hubPotClaim",
      "discriminator": [
        135,
        227,
        41,
        78,
        222,
        214,
        96,
        221
      ]
    },
    {
      "name": "hubPotConfig",
      "discriminator": [
        88,
        211,
        114,
        180,
        153,
        101,
        120,
        25
      ]
    },
    {
      "name": "hubPotRound",
      "discriminator": [
        242,
        7,
        76,
        135,
        86,
        165,
        160,
        106
      ]
    },
    {
      "name": "otcPayConfig",
      "discriminator": [
        255,
        93,
        46,
        105,
        118,
        68,
        137,
        98
      ]
    },
    {
      "name": "otcPotState",
      "discriminator": [
        224,
        181,
        88,
        79,
        111,
        236,
        217,
        206
      ]
    },
    {
      "name": "rewardClaim",
      "discriminator": [
        194,
        80,
        130,
        80,
        113,
        62,
        2,
        91
      ]
    },
    {
      "name": "rewardRound",
      "discriminator": [
        175,
        204,
        6,
        220,
        209,
        208,
        47,
        98
      ]
    },
    {
      "name": "tokenomicsConfig",
      "discriminator": [
        43,
        6,
        224,
        196,
        51,
        132,
        142,
        115
      ]
    },
    {
      "name": "treasuryState",
      "discriminator": [
        240,
        56,
        226,
        158,
        138,
        244,
        79,
        154
      ]
    }
  ],
  "events": [
    {
      "name": "airdropClaimed",
      "discriminator": [
        125,
        251,
        195,
        183,
        202,
        126,
        89,
        68
      ]
    },
    {
      "name": "airdropDistributed",
      "discriminator": [
        150,
        40,
        93,
        36,
        137,
        4,
        173,
        131
      ]
    },
    {
      "name": "airdropRootSet",
      "discriminator": [
        200,
        53,
        71,
        195,
        125,
        232,
        157,
        123
      ]
    },
    {
      "name": "creatorFeeBurnRecorded",
      "discriminator": [
        215,
        241,
        90,
        52,
        32,
        114,
        204,
        35
      ]
    },
    {
      "name": "creatorFeeCleared",
      "discriminator": [
        235,
        216,
        61,
        112,
        189,
        154,
        84,
        74
      ]
    },
    {
      "name": "creatorFeeLegDrawn",
      "discriminator": [
        1,
        71,
        173,
        141,
        110,
        73,
        118,
        130
      ]
    },
    {
      "name": "creatorFeeOpsRecorded",
      "discriminator": [
        224,
        217,
        89,
        26,
        148,
        10,
        74,
        170
      ]
    },
    {
      "name": "creatorFeeReceived",
      "discriminator": [
        114,
        154,
        104,
        196,
        226,
        142,
        131,
        75
      ]
    },
    {
      "name": "creatorFeeStackRecorded",
      "discriminator": [
        156,
        234,
        129,
        87,
        48,
        163,
        237,
        63
      ]
    },
    {
      "name": "epochFinalized",
      "discriminator": [
        109,
        54,
        231,
        81,
        101,
        249,
        145,
        107
      ]
    },
    {
      "name": "epochSolSwapped",
      "discriminator": [
        186,
        193,
        241,
        194,
        62,
        168,
        162,
        138
      ]
    },
    {
      "name": "hubPotFunded",
      "discriminator": [
        245,
        123,
        128,
        44,
        207,
        139,
        160,
        0
      ]
    },
    {
      "name": "hubPotMintUpdated",
      "discriminator": [
        191,
        7,
        125,
        27,
        248,
        149,
        9,
        203
      ]
    },
    {
      "name": "hubPotProtocolFeeSkimmed",
      "discriminator": [
        249,
        247,
        21,
        153,
        48,
        124,
        216,
        174
      ]
    },
    {
      "name": "hubPotRewardClaimed",
      "discriminator": [
        213,
        201,
        142,
        136,
        203,
        178,
        127,
        157
      ]
    },
    {
      "name": "hubPotRewardDistributed",
      "discriminator": [
        76,
        84,
        9,
        31,
        125,
        174,
        104,
        41
      ]
    },
    {
      "name": "hubPotRoundOpened",
      "discriminator": [
        86,
        161,
        117,
        46,
        8,
        53,
        16,
        4
      ]
    },
    {
      "name": "inflowRegistered",
      "discriminator": [
        219,
        9,
        79,
        67,
        127,
        91,
        205,
        111
      ]
    },
    {
      "name": "lpBuilt",
      "discriminator": [
        99,
        165,
        50,
        24,
        253,
        107,
        97,
        177
      ]
    },
    {
      "name": "lpCompounded",
      "discriminator": [
        253,
        5,
        113,
        109,
        21,
        81,
        9,
        23
      ]
    },
    {
      "name": "lpFeesHarvested",
      "discriminator": [
        230,
        156,
        123,
        178,
        68,
        124,
        167,
        67
      ]
    },
    {
      "name": "lpLocked",
      "discriminator": [
        231,
        255,
        40,
        229,
        17,
        147,
        106,
        125
      ]
    },
    {
      "name": "otcBuyRecorded",
      "discriminator": [
        136,
        19,
        51,
        241,
        24,
        162,
        4,
        109
      ]
    },
    {
      "name": "otcPaymentsEnabledSet",
      "discriminator": [
        4,
        195,
        142,
        124,
        133,
        104,
        88,
        53
      ]
    },
    {
      "name": "tierActivated",
      "discriminator": [
        197,
        100,
        54,
        44,
        40,
        207,
        221,
        194
      ]
    },
    {
      "name": "tierPaidOtc",
      "discriminator": [
        61,
        179,
        219,
        168,
        101,
        116,
        255,
        145
      ]
    },
    {
      "name": "tierUpgraded",
      "discriminator": [
        141,
        12,
        195,
        74,
        212,
        102,
        162,
        123
      ]
    },
    {
      "name": "tierVoided",
      "discriminator": [
        8,
        138,
        53,
        221,
        230,
        61,
        5,
        126
      ]
    },
    {
      "name": "treasuryFloatCapUpdated",
      "discriminator": [
        131,
        125,
        229,
        40,
        254,
        160,
        217,
        102
      ]
    },
    {
      "name": "treasuryFloatInitialized",
      "discriminator": [
        245,
        252,
        92,
        138,
        195,
        23,
        168,
        210
      ]
    },
    {
      "name": "treasuryRewardDistributed",
      "discriminator": [
        214,
        41,
        72,
        131,
        134,
        162,
        230,
        112
      ]
    },
    {
      "name": "treasuryRewardFunded",
      "discriminator": [
        252,
        249,
        49,
        39,
        173,
        87,
        137,
        249
      ]
    },
    {
      "name": "treasuryRewardRoundOpened",
      "discriminator": [
        215,
        125,
        97,
        30,
        220,
        41,
        77,
        87
      ]
    },
    {
      "name": "yieldClaimed",
      "discriminator": [
        177,
        201,
        94,
        68,
        19,
        200,
        227,
        27
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "paused",
      "msg": "Program is paused"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Unauthorized"
    },
    {
      "code": 6002,
      "name": "bpsOutOfRange",
      "msg": "Basis-point value out of range"
    },
    {
      "code": 6003,
      "name": "fieldNotUpdatable",
      "msg": "Config field is not whitelisted for update"
    },
    {
      "code": 6004,
      "name": "invalidTier",
      "msg": "Tier out of range (1-4)"
    },
    {
      "code": 6005,
      "name": "invalidTierStep",
      "msg": "Tier can only be upgraded by exactly one step from current"
    },
    {
      "code": 6006,
      "name": "tierMaxed",
      "msg": "Tier is already at maximum"
    },
    {
      "code": 6007,
      "name": "tierAlreadyActive",
      "msg": "Tier is already active; use upgrade_tier"
    },
    {
      "code": 6008,
      "name": "claimBeforeUpgrade",
      "msg": "Claim pending yield before upgrading"
    },
    {
      "code": 6009,
      "name": "noActiveStakers",
      "msg": "No active stakers (Σw == 0); nothing to distribute"
    },
    {
      "code": 6010,
      "name": "notCoreAsset",
      "msg": "Account is not a Metaplex Core AssetV1"
    },
    {
      "code": 6011,
      "name": "wrongEpoch",
      "msg": "Wrong epoch account for the current epoch"
    },
    {
      "code": 6012,
      "name": "epochNotCurrent",
      "msg": "Epoch index is not the current open epoch"
    },
    {
      "code": 6013,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6014,
      "name": "lpPositionExists",
      "msg": "LP position for this pair already exists (one per pair)"
    },
    {
      "code": 6015,
      "name": "tierVoided",
      "msg": "Tier has been voided by an ownership change; re-activate"
    },
    {
      "code": 6016,
      "name": "notDeskOwner",
      "msg": "Caller does not own the desk asset"
    },
    {
      "code": 6017,
      "name": "wrongCollection",
      "msg": "Desk asset does not belong to the configured collection"
    },
    {
      "code": 6018,
      "name": "potBelowThreshold",
      "msg": "Open epoch inflow is below min_pot_threshold_lamports"
    },
    {
      "code": 6019,
      "name": "epochAlreadyFinalized",
      "msg": "Epoch already finalized"
    },
    {
      "code": 6020,
      "name": "epochNotFinalized",
      "msg": "Epoch is not finalized"
    },
    {
      "code": 6021,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6022,
      "name": "potBelowLiability",
      "msg": "Pot lamports below liability"
    },
    {
      "code": 6023,
      "name": "invariantViolated",
      "msg": "Inflow accounting invariant violated"
    },
    {
      "code": 6024,
      "name": "lpDisabled",
      "msg": "LP building is disabled"
    },
    {
      "code": 6025,
      "name": "lpPhase2Gated",
      "msg": "HUB/OTC LP is gated until phase-2 conditions hold"
    },
    {
      "code": 6026,
      "name": "floorStale",
      "msg": "Floor moved more than the staleness guard since tx build"
    },
    {
      "code": 6027,
      "name": "treasurySelfDeal",
      "msg": "Treasury may not buy its own exit"
    },
    {
      "code": 6028,
      "name": "burnPendingUnderflow",
      "msg": "Burn-pending underflow"
    },
    {
      "code": 6029,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6030,
      "name": "otcPaymentsDisabled",
      "msg": "$OTC payments are disabled"
    },
    {
      "code": 6031,
      "name": "otcRateStale",
      "msg": "$OTC reference rate is stale; authority must refresh it"
    },
    {
      "code": 6032,
      "name": "invalidTokenAccount",
      "msg": "Account is not an SPL token account for the expected mint/owner"
    },
    {
      "code": 6033,
      "name": "wrongTokenProgram",
      "msg": "Token program does not match the configured mint"
    },
    {
      "code": 6034,
      "name": "allocationExceedsSupply",
      "msg": "Airdrop + treasury lock + team allocations exceed the max supply"
    },
    {
      "code": 6035,
      "name": "airdropClosed",
      "msg": "Airdrop claims are not open"
    },
    {
      "code": 6036,
      "name": "airdropInvalidProof",
      "msg": "Merkle proof does not match the published airdrop root"
    },
    {
      "code": 6037,
      "name": "airdropLocked",
      "msg": "Airdrop root cannot change once claims have been paid"
    },
    {
      "code": 6038,
      "name": "notImplemented",
      "msg": "Not implemented in this milestone"
    },
    {
      "code": 6039,
      "name": "otcBuyExceedsPending",
      "msg": "OTC buy spend exceeds otc_pending_lamports"
    },
    {
      "code": 6040,
      "name": "noOtcPurchased",
      "msg": "No $OTC has been purchased yet; nothing claimable"
    },
    {
      "code": 6041,
      "name": "creatorFeeBelowThreshold",
      "msg": "Creator-fee pending balance is below the clearing threshold"
    },
    {
      "code": 6042,
      "name": "creatorFeeLegExceedsPending",
      "msg": "Creator-fee leg draw exceeds that leg's pending balance"
    },
    {
      "code": 6043,
      "name": "lpAccountsMissing",
      "msg": "build_lp requires AMM CPI accounts in remaining_accounts"
    },
    {
      "code": 6044,
      "name": "airdropCapExceeded",
      "msg": "Airdrop snapshot desk count exceeds the 2,500-desk cap"
    },
    {
      "code": 6045,
      "name": "noRewardPending",
      "msg": "No treasury reward pending; call fund_treasury_reward first"
    },
    {
      "code": 6046,
      "name": "rewardRoundExceeded",
      "msg": "Reward round payout would exceed the round's snapshotted amount"
    },
    {
      "code": 6047,
      "name": "deskNotActive",
      "msg": "Desk is not an active tier holder"
    },
    {
      "code": 6048,
      "name": "noHubPotPending",
      "msg": "No HUB Pot bucket has a pending balance; call fund_hub_pot first"
    },
    {
      "code": 6049,
      "name": "hubPotRoundExceeded",
      "msg": "HUB Pot round payout would exceed a bucket's snapshotted amount"
    },
    {
      "code": 6050,
      "name": "hubPotBucketNotDrained",
      "msg": "HUB Pot bucket still has a pending balance; open/settle a round before swapping its mint"
    },
    {
      "code": 6051,
      "name": "slippageExceeded",
      "msg": "Jupiter swap returned less than the required minimum output"
    },
    {
      "code": 6052,
      "name": "wrongJupiterProgram",
      "msg": "CPI target does not match the configured Jupiter program id"
    },
    {
      "code": 6053,
      "name": "swapAccountsMissing",
      "msg": "Jupiter route requires accounts in remaining_accounts"
    },
    {
      "code": 6054,
      "name": "treasuryFloatNotInitialized",
      "msg": "Treasury float vault has not been initialized"
    },
    {
      "code": 6055,
      "name": "lpCompoundBelowThreshold",
      "msg": "lp_pending_hub_units is below the compounding dust floor"
    },
    {
      "code": 6056,
      "name": "invalidLpPair",
      "msg": "LpPair does not apply to this instruction (e.g. HubSol has no locked position)"
    },
    {
      "code": 6057,
      "name": "harvestBalanceUnderflow",
      "msg": "Fee-harvest CPI reported a lower balance than before the call"
    },
    {
      "code": 6058,
      "name": "hopAccountSplitOutOfRange",
      "msg": "hop1_account_count exceeds the number of accounts supplied in remaining_accounts"
    }
  ],
  "types": [
    {
      "name": "airdropClaim",
      "docs": [
        "`[\"airdrop\", asset]` — one claim per desk asset; existence is the double-claim guard."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          },
          {
            "name": "amountUnits",
            "type": "u64"
          },
          {
            "name": "claimedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "airdropClaimed",
      "docs": [
        "User-initiated pull via `claim_airdrop`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          },
          {
            "name": "amountUnits",
            "type": "u64"
          },
          {
            "name": "totalClaimedUnits",
            "type": "u64"
          },
          {
            "name": "claims",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "airdropDistributed",
      "docs": [
        "Authority-initiated push via `distribute_airdrop` — same `AirdropClaim` PDA guard as",
        "`AirdropClaimed`, so a desk can only ever appear in one of the two events, never both."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountUnits",
            "type": "u64"
          },
          {
            "name": "totalClaimedUnits",
            "type": "u64"
          },
          {
            "name": "claims",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "airdropRootSet",
      "docs": [
        "§A7.1 — snapshot published (round 1) or extended (round ≥2 — desk_count grew to onboard",
        "newly-minted desks) / claims toggled."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "root",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "deskCount",
            "type": "u32"
          },
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "airdropUnits",
            "type": "u64"
          },
          {
            "name": "airdropBp",
            "type": "u16"
          },
          {
            "name": "publicBp",
            "type": "u16"
          },
          {
            "name": "open",
            "type": "bool"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "burnState",
      "docs": [
        "`Pot` is a system-owned PDA (`[\"pot\"]`); balance = account lamports. It has",
        "no data — liability is tracked on `Burn`/`Epoch` and Σ StakerAccrual."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "totalHubBurned",
            "type": "u64"
          },
          {
            "name": "lastBurnTx",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "pot",
            "type": "pubkey"
          },
          {
            "name": "opsWallet",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "otcProgram",
            "docs": [
              "OTC-side references resolved at runtime (§A2), never hardcoded."
            ],
            "type": "pubkey"
          },
          {
            "name": "otcDeskPot",
            "type": "pubkey"
          },
          {
            "name": "deskCollection",
            "type": "pubkey"
          },
          {
            "name": "hubMint",
            "type": "pubkey"
          },
          {
            "name": "otcMint",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "docs": [
              "USDC mint used by `finalize_epoch`'s two-hop price-discovery swap (WSOL→USDC→$HUB).",
              "Admin-updatable (`ConfigField::UsdcMint`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "tierWeightsBp",
            "type": {
              "array": [
                "u16",
                4
              ]
            }
          },
          {
            "name": "stepFeeLamports",
            "type": "u64"
          },
          {
            "name": "tierUsdCostMicros",
            "docs": [
              "Fixed USD target per tier, in micro-USDC (6 decimals) — see `TIER_USD_COST_MICROS`. Never",
              "changes at runtime (no `ConfigField` variant); the token-unit equivalent that moves with",
              "$HUB's market price is `tier_hub_cost_units_cached` below."
            ],
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "tierHubCostUnitsCached",
            "docs": [
              "$HUB base units currently equal to `tier_usd_cost_micros`, refreshed by `finalize_epoch`'s",
              "two-hop Jupiter price observation — clamped to ±`PRICE_CLAMP_BP` per eligible round and",
              "bounded to [`TIER_HUB_COST_FLOOR_BP`, 100%] of the `TIER_HUB_COST_UNITS` ceiling table.",
              "Never read directly — always through `Config::hub_cost`, which falls back to the ceiling",
              "table when `last_price_update_ts` is stale (`PRICE_STALENESS_SECS`)."
            ],
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "lastPriceUpdateTs",
            "docs": [
              "Unix timestamp of the last eligible price update; 0 = never updated (treated as stale)."
            ],
            "type": "i64"
          },
          {
            "name": "tierCostBurnBp",
            "docs": [
              "bp of every tier activation/upgrade's $HUB cost that is burned outright — the remainder",
              "funds the active-desk reward pool instead (see `TIER_COST_BURN_BP`). Admin-updatable",
              "(`ConfigField::TierCostBurnBp`)."
            ],
            "type": "u16"
          },
          {
            "name": "minPotThresholdLamports",
            "docs": [
              "A round closes once the open epoch's inflow reaches this (no clock involved)."
            ],
            "type": "u64"
          },
          {
            "name": "burnPctBp",
            "type": "u16"
          },
          {
            "name": "lpPctBp",
            "docs": [
              "§A5 2.5%: swapped SOL→$HUB at finalize and earmarked into",
              "`TreasuryState.lp_pending_hub_units` for the $HUB/$OTC LP (phase-2 `build_lp_otc_locked`)."
            ],
            "type": "u16"
          },
          {
            "name": "treasuryFloatPctBp",
            "docs": [
              "§A5 2.5%: swapped SOL→$HUB at finalize and deposited into",
              "`TreasuryState.treasury_float_vault` (buy-and-hold, capped). Remainder after",
              "burn + lp + treasury_float is the 90% $OTC leg."
            ],
            "type": "u16"
          },
          {
            "name": "opsPctBp",
            "type": "u16"
          },
          {
            "name": "protocolFeeBp",
            "docs": [
              "§A5 revenue-model extension — bp of *treasury-controlled* revenue (not the desk-holder",
              "activation fee) skimmed to `ops_wallet` at the source, before it becomes staker/desk-holder",
              "yield. See `constants::PROTOCOL_FEE_BP`'s doc comment for the two call sites."
            ],
            "type": "u16"
          },
          {
            "name": "lpEnabled",
            "type": "bool"
          },
          {
            "name": "lpTargetSolLamports",
            "type": "u64"
          },
          {
            "name": "lpPhase2OpenTs",
            "docs": [
              "§A6.2 phase-2 gate: HUB/OTC LP opens only after this timestamp (0 = closed)."
            ],
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "currentEpoch",
            "docs": [
              "Index of the open (accruing) epoch; `Epoch[current_epoch]` always exists."
            ],
            "type": "u64"
          },
          {
            "name": "genesisTs",
            "type": "i64"
          },
          {
            "name": "totalWeightBp",
            "docs": [
              "Running Σw (bp) of non-voided DeskTiers; snapshotted into `Epoch` at finalize."
            ],
            "type": "u64"
          },
          {
            "name": "potLiabilityLamports",
            "docs": [
              "Lamports the pot owes (unclaimed allotments + burn-pending + carry). Pot ≥ this, always."
            ],
            "type": "u64"
          },
          {
            "name": "accPerWeight",
            "docs": [
              "Cumulative lamports × ACC_SCALE credited per bp of weight (OTC \"counter\"). A tier's",
              "pending yield is `(acc − stamp) × w / ACC_SCALE`, so one claim settles every round."
            ],
            "type": "u128"
          },
          {
            "name": "dustScaled",
            "docs": [
              "Scaled lamports credited to the accumulator but owed to nobody (claim floor remainders,",
              "ceil slack at finalize, forfeits of voided tiers). Whole lamports re-enter as inflow at",
              "the next finalize, so the pot stays zero-sum."
            ],
            "type": "u128"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "potBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configField",
      "docs": [
        "Fields `update_config` may touch (§B3 #9). Rate changes apply to future epochs."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "opsWallet"
          },
          {
            "name": "otcProgram"
          },
          {
            "name": "otcDeskPot"
          },
          {
            "name": "deskCollection"
          },
          {
            "name": "hubMint"
          },
          {
            "name": "otcMint"
          },
          {
            "name": "usdcMint"
          },
          {
            "name": "tierCostBurnBp"
          },
          {
            "name": "burnPctBp"
          },
          {
            "name": "lpPctBp"
          },
          {
            "name": "treasuryFloatPctBp"
          },
          {
            "name": "opsPctBp"
          },
          {
            "name": "protocolFeeBp"
          },
          {
            "name": "lpEnabled"
          },
          {
            "name": "lpTargetSolLamports"
          },
          {
            "name": "lpPhase2OpenTs"
          },
          {
            "name": "minPotThresholdLamports"
          },
          {
            "name": "treasury"
          },
          {
            "name": "authority"
          }
        ]
      }
    },
    {
      "name": "configValue",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pubkey",
            "fields": [
              "pubkey"
            ]
          },
          {
            "name": "u64",
            "fields": [
              "u64"
            ]
          },
          {
            "name": "u16",
            "fields": [
              "u16"
            ]
          },
          {
            "name": "bool",
            "fields": [
              "bool"
            ]
          },
          {
            "name": "i64",
            "fields": [
              "i64"
            ]
          }
        ]
      }
    },
    {
      "name": "creatorFeeBurnRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcSpent",
            "type": "u64"
          },
          {
            "name": "hubBurned",
            "type": "u64"
          },
          {
            "name": "totalHubBurnedAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeeCleared",
      "docs": [
        "Pending balance split 80/5/5/5/5 into per-leg earmarks; the 80% desk-pot leg is injected",
        "into `OtcPotState` in the same instruction (no swap needed — it's already $OTC)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "clearedOtc",
            "type": "u64"
          },
          {
            "name": "deskPotOtc",
            "type": "u64"
          },
          {
            "name": "burnOtc",
            "type": "u64"
          },
          {
            "name": "lpOtc",
            "type": "u64"
          },
          {
            "name": "stackOtc",
            "type": "u64"
          },
          {
            "name": "opsOtc",
            "type": "u64"
          },
          {
            "name": "otcPotTotalBoughtUnitsAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeeLeg",
      "docs": [
        "Legs a keeper may draw for an off-chain swap. `DeskPot` is excluded — it's injected directly",
        "by `clear_creator_fees`, no swap needed."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "burn"
          },
          {
            "name": "lp"
          },
          {
            "name": "stack"
          },
          {
            "name": "ops"
          }
        ]
      }
    },
    {
      "name": "creatorFeeLegDrawn",
      "docs": [
        "Keeper draws a leg's earmarked $OTC out of the vault to execute its off-chain swap."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "leg",
            "type": "u8"
          },
          {
            "name": "otcAmount",
            "type": "u64"
          },
          {
            "name": "pendingAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeeOpsRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcSpent",
            "type": "u64"
          },
          {
            "name": "solAmount",
            "type": "u64"
          },
          {
            "name": "totalOpsSolAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeeReceived",
      "docs": [
        "§A6.3 — treasury deposits its claimed launcher holder-leg $OTC into the creator-fee vault."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcReceived",
            "type": "u64"
          },
          {
            "name": "pendingAfter",
            "type": "u64"
          },
          {
            "name": "totalReceived",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeeStackRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcSpent",
            "type": "u64"
          },
          {
            "name": "hubAmount",
            "type": "u64"
          },
          {
            "name": "totalStackHubAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "creatorFeeState",
      "docs": [
        "§A6.3 second flywheel — `[\"creator_fee\"]`. Created by the authority after `initialize_config`",
        "(same no-migration pattern as `OtcPotState`). `creator_fee_vault` (mint = `Config.otc_mint`,",
        "owner = `[\"pot\"]` PDA — same custody PDA as `otc_vault`) holds the treasury's pro-rata claim",
        "on the OTC launcher's 70% holders-in-stock leg, deposited via `record_creator_fee`",
        "(`TransferChecked`, enforced). Once `pending_otc_units ≥ clear_threshold_units`,",
        "`clear_creator_fees` splits the whole pending balance 80/5/5/5/5 into five earmarks: the 80%",
        "desk-pot leg is injected into `OtcPotState` in the same instruction (no swap — it's already",
        "$OTC, so it only raises `total_otc_bought_units`, never `total_lamports_spent`, mechanically",
        "lifting the lifetime average buy rate for every desk). The other four legs are drawn by the",
        "keeper (`draw_creator_fee_leg`) for an off-chain swap, then attested back on-chain."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "creatorFeeVault",
            "type": "pubkey"
          },
          {
            "name": "clearThresholdUnits",
            "type": "u64"
          },
          {
            "name": "pendingOtcUnits",
            "docs": [
              "Received but not yet split by `clear_creator_fees`."
            ],
            "type": "u64"
          },
          {
            "name": "burnPendingOtc",
            "type": "u64"
          },
          {
            "name": "lpPendingOtc",
            "type": "u64"
          },
          {
            "name": "stackPendingOtc",
            "type": "u64"
          },
          {
            "name": "opsPendingOtc",
            "type": "u64"
          },
          {
            "name": "totalReceivedOtc",
            "type": "u64"
          },
          {
            "name": "totalDeskPotOtc",
            "type": "u64"
          },
          {
            "name": "totalBurnOtc",
            "type": "u64"
          },
          {
            "name": "totalBurnHub",
            "type": "u64"
          },
          {
            "name": "totalLpOtc",
            "type": "u64"
          },
          {
            "name": "totalStackOtc",
            "type": "u64"
          },
          {
            "name": "totalStackHub",
            "type": "u64"
          },
          {
            "name": "totalOpsOtc",
            "type": "u64"
          },
          {
            "name": "totalOpsSolLamports",
            "type": "u64"
          },
          {
            "name": "lastReceiveTx",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "lastBurnResultTx",
            "docs": [
              "Replay guard for `record_creator_fee_burn_result` (trust-attested)."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "lastStackTx",
            "docs": [
              "Replay guard for `record_creator_fee_stack`."
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "deskTier",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "assetId",
            "type": "pubkey"
          },
          {
            "name": "ownerAtActivation",
            "docs": [
              "Owner at activation; re-verified lazily at claim/upgrade (§B3 #5)."
            ],
            "type": "pubkey"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "activatedEpoch",
            "type": "u64"
          },
          {
            "name": "stampAccPerWeight",
            "docs": [
              "`Config.acc_per_weight` at activation / last claim (OTC \"stamp\")."
            ],
            "type": "u128"
          },
          {
            "name": "totalClaimedLamports",
            "docs": [
              "Lifetime SOL this desk has been paid by `claim_yield` (reset on re-activation)."
            ],
            "type": "u64"
          },
          {
            "name": "voided",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "docs": [
        "One round of the pot. Opens at the previous finalize, closes when inflow ≥ threshold."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "finalizedTs",
            "docs": [
              "0 while open."
            ],
            "type": "i64"
          },
          {
            "name": "inflowLamports",
            "type": "u64"
          },
          {
            "name": "distributedLamports",
            "docs": [
              "Lamports credited to stakers through `acc_per_weight` at finalize (§A5 90% $OTC leg,",
              "lamport-equivalent value — `claim_yield` converts it to $OTC at the pot's lifetime",
              "average buy rate)."
            ],
            "type": "u64"
          },
          {
            "name": "burnPendingLamports",
            "docs": [
              "§A5 5% — SOL input to this epoch's burn leg, swapped $HUB→burned synchronously inside",
              "`finalize_epoch` (no longer a keeper-drawn pending balance)."
            ],
            "type": "u64"
          },
          {
            "name": "lpPendingLamports",
            "docs": [
              "§A5 2.5% — SOL input to this epoch's LP-build leg, swapped to $HUB and added to",
              "`TreasuryState.lp_pending_hub_units`."
            ],
            "type": "u64"
          },
          {
            "name": "treasuryFloatLamports",
            "docs": [
              "§A5 2.5% — SOL input to this epoch's treasury-float leg, swapped to $HUB and deposited",
              "into `TreasuryState.treasury_float_vault` (capped; excess folded into the burn leg)."
            ],
            "type": "u64"
          },
          {
            "name": "rolledForwardLamports",
            "docs": [
              "`distributable − distributed` (≤ 1 lamport of floor loss) → next epoch's opening inflow."
            ],
            "type": "u64"
          },
          {
            "name": "totalWeightBp",
            "docs": [
              "Σw of non-voided DeskTiers at finalize (bp-weighted)."
            ],
            "type": "u64"
          },
          {
            "name": "perWeightScaled",
            "docs": [
              "This round's increment of `acc_per_weight` and the counter value after it."
            ],
            "type": "u128"
          },
          {
            "name": "accPerWeightAfter",
            "type": "u128"
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "inflowLamports",
            "type": "u64"
          },
          {
            "name": "distributedLamports",
            "type": "u64"
          },
          {
            "name": "burnPendingLamports",
            "docs": [
              "SOL input to this epoch's burn leg — swapped and burned synchronously, not left pending."
            ],
            "type": "u64"
          },
          {
            "name": "lpPendingLamports",
            "docs": [
              "SOL input to this epoch's LP-build leg — swapped to $HUB and earmarked, not left pending."
            ],
            "type": "u64"
          },
          {
            "name": "treasuryFloatLamports",
            "docs": [
              "SOL input to this epoch's treasury-float leg — swapped to $HUB and deposited/burned."
            ],
            "type": "u64"
          },
          {
            "name": "rolledForwardLamports",
            "type": "u64"
          },
          {
            "name": "totalWeightBp",
            "type": "u64"
          },
          {
            "name": "perWeightScaled",
            "type": "u128"
          },
          {
            "name": "accPerWeight",
            "type": "u128"
          }
        ]
      }
    },
    {
      "name": "epochSolSwapped",
      "docs": [
        "The synchronous two-hop Jupiter WSOL→USDC→$HUB CPI executed inside `finalize_epoch` for the",
        "combined burn/LP/treasury-float legs (10% of inflow). `usdc_received` is hop1's (WSOL→USDC)",
        "output; `hub_received` is hop2's (USDC→$HUB) output, which splits 50/25/25 into",
        "`hub_burned`/`hub_lp_earmarked`/`hub_float_requested`; `hub_float_deposited` may be less than",
        "`hub_float_requested` if the cap was hit, with the remainder folded into `hub_burned`.",
        "`price_updated` is true when `sol_swapped_lamports` cleared `PRICE_UPDATE_MIN_SOL_LAMPORTS`",
        "and the realized USDC/HUB rate was used to refresh `tier_hub_cost_units_after` (clamped by",
        "`clamp_tier_cost`); when false, `tier_hub_cost_units_after` is unchanged from before this call."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "solSwappedLamports",
            "type": "u64"
          },
          {
            "name": "usdcReceived",
            "type": "u64"
          },
          {
            "name": "hubReceived",
            "type": "u64"
          },
          {
            "name": "hubBurned",
            "type": "u64"
          },
          {
            "name": "hubLpEarmarked",
            "type": "u64"
          },
          {
            "name": "hubFloatRequested",
            "type": "u64"
          },
          {
            "name": "hubFloatDeposited",
            "type": "u64"
          },
          {
            "name": "treasuryFloatUnitsAfter",
            "type": "u64"
          },
          {
            "name": "priceUpdated",
            "type": "bool"
          },
          {
            "name": "tierHubCostUnitsAfter",
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "lastPriceUpdateTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "hubPotBucket",
      "docs": [
        "Bucket selector for `update_hub_pot_mint` — lets governance rotate a basket asset (e.g. a",
        "synthetic pre-IPO token judged too exposed to post-listing deviation risk, as with the",
        "original OpenAI/Anthropic pre-IPO legs before genesis swapped them for the live, directly",
        "custodied NVDAx/SPCXx xStock RWAs) for a different mint without a program upgrade/migration.",
        "Mirrors `CreatorFeeLeg`'s enum-selects-a-field pattern; field *names* on `HubPotConfig`",
        "(otc/crclx/nvdax/spcxx) are fixed identifiers from genesis and don't necessarily track which",
        "real-world asset currently backs a bucket — e.g. the \"nvdax\" bucket may later be kept as a",
        "label while its mint points at a different asset entirely."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "otc"
          },
          {
            "name": "crclx"
          },
          {
            "name": "nvdax"
          },
          {
            "name": "spcxx"
          }
        ]
      }
    },
    {
      "name": "hubPotClaim",
      "docs": [
        "`[\"hub_pot_claim\", round_index, asset]` — one payout per desk asset per HUB Pot round;",
        "existence is the double-payout guard (mirrors `RewardClaim`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "otcUnits",
            "type": "u64"
          },
          {
            "name": "crclxUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxUnits",
            "type": "u64"
          },
          {
            "name": "spcxxUnits",
            "type": "u64"
          },
          {
            "name": "claimedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "hubPotConfig",
      "docs": [
        "§A5.1 `[\"hub_pot\"]` — MemeStock basket ($OTC, CRCLx, NVDAx, SPCXx) bookkeeping.",
        "Created once via `init_hub_pot`. Funded by the treasury's converted source-B (13-stock",
        "treasury-desk) yield via `fund_hub_pot`; independent of `TokenomicsConfig`'s single-asset",
        "$HUB reward path (§A6.3/§A7.1 bridge) — different funding source, different vaults."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcMint",
            "type": "pubkey"
          },
          {
            "name": "crclxMint",
            "type": "pubkey"
          },
          {
            "name": "nvdaxMint",
            "type": "pubkey"
          },
          {
            "name": "spcxxMint",
            "type": "pubkey"
          },
          {
            "name": "otcVault",
            "docs": [
              "Vault-owned (`[\"vault\"]` PDA) token accounts, one per bucket mint above."
            ],
            "type": "pubkey"
          },
          {
            "name": "crclxVault",
            "type": "pubkey"
          },
          {
            "name": "nvdaxVault",
            "type": "pubkey"
          },
          {
            "name": "spcxxVault",
            "type": "pubkey"
          },
          {
            "name": "otcPendingUnits",
            "docs": [
              "Earmarked since the last `open_hub_pot_round`, awaiting the next snapshot."
            ],
            "type": "u64"
          },
          {
            "name": "crclxPendingUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxPendingUnits",
            "type": "u64"
          },
          {
            "name": "spcxxPendingUnits",
            "type": "u64"
          },
          {
            "name": "otcDepositedUnits",
            "docs": [
              "Lifetime totals, for dashboard display — never decreases."
            ],
            "type": "u64"
          },
          {
            "name": "crclxDepositedUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxDepositedUnits",
            "type": "u64"
          },
          {
            "name": "spcxxDepositedUnits",
            "type": "u64"
          },
          {
            "name": "roundCount",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "hubPotFunded",
      "docs": [
        "§A5.1 — treasury deposits converted source-B (13-stock) yield into the 4 HUB Pot buckets."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcAmount",
            "type": "u64"
          },
          {
            "name": "crclxAmount",
            "type": "u64"
          },
          {
            "name": "nvdaxAmount",
            "type": "u64"
          },
          {
            "name": "spcxxAmount",
            "type": "u64"
          },
          {
            "name": "otcPendingAfter",
            "type": "u64"
          },
          {
            "name": "crclxPendingAfter",
            "type": "u64"
          },
          {
            "name": "nvdaxPendingAfter",
            "type": "u64"
          },
          {
            "name": "spcxxPendingAfter",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "hubPotMintUpdated",
      "docs": [
        "Governance-only bucket mint swap (`update_hub_pot_mint`) — e.g. rotating a synthetic",
        "pre-IPO token out for a directly-backed xStock RWA once its deviation risk is reassessed.",
        "`swept_to_ops` is any dust the old vault held at swap time, sent to `Config.ops_wallet`'s ATA",
        "for `old_mint` so nothing is stranded once `hub_pot` stops pointing at `old_vault`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bucket",
            "type": "u8"
          },
          {
            "name": "oldMint",
            "type": "pubkey"
          },
          {
            "name": "newMint",
            "type": "pubkey"
          },
          {
            "name": "oldVault",
            "type": "pubkey"
          },
          {
            "name": "newVault",
            "type": "pubkey"
          },
          {
            "name": "sweptToOps",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "hubPotProtocolFeeSkimmed",
      "docs": [
        "§A5 revenue-model extension — `Config.protocol_fee_bp` skimmed per-mint into `ops_wallet`'s",
        "ATAs in the same `fund_hub_pot` call the `HubPotFunded` above reports (that event's amounts",
        "are already net of this skim)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcToOps",
            "type": "u64"
          },
          {
            "name": "crclxToOps",
            "type": "u64"
          },
          {
            "name": "nvdaxToOps",
            "type": "u64"
          },
          {
            "name": "spcxxToOps",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "hubPotRewardClaimed",
      "docs": [
        "User-initiated pull via `claim_hub_pot_reward` — same `HubPotClaim` PDA guard as",
        "`HubPotRewardDistributed`, so a desk can only ever appear in one of the two events per round."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          },
          {
            "name": "otcUnits",
            "type": "u64"
          },
          {
            "name": "crclxUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxUnits",
            "type": "u64"
          },
          {
            "name": "spcxxUnits",
            "type": "u64"
          },
          {
            "name": "claims",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "hubPotRewardDistributed",
      "docs": [
        "Authority-pushed payout of one active desk's tier-weighted share of all 4 HUB Pot buckets."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "otcUnits",
            "type": "u64"
          },
          {
            "name": "crclxUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxUnits",
            "type": "u64"
          },
          {
            "name": "spcxxUnits",
            "type": "u64"
          },
          {
            "name": "claims",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "hubPotRound",
      "docs": [
        "`[\"hub_pot_round\", index]` — one `fund_hub_pot` snapshot: all 4 bucket pending balances",
        "split across the active desks' Σw (`Config.total_weight_bp`) at the moment",
        "`open_hub_pot_round` was called. Mirrors `RewardRound`, ×4 mints."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "otcUnits",
            "type": "u64"
          },
          {
            "name": "crclxUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxUnits",
            "type": "u64"
          },
          {
            "name": "spcxxUnits",
            "type": "u64"
          },
          {
            "name": "totalWeightBp",
            "type": "u64"
          },
          {
            "name": "otcDistributedUnits",
            "type": "u64"
          },
          {
            "name": "crclxDistributedUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxDistributedUnits",
            "type": "u64"
          },
          {
            "name": "spcxxDistributedUnits",
            "type": "u64"
          },
          {
            "name": "claims",
            "type": "u32"
          },
          {
            "name": "openedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "hubPotRoundOpened",
      "docs": [
        "Permissionless snapshot: each bucket's pending balance split across the active desks' Σw."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "otcUnits",
            "type": "u64"
          },
          {
            "name": "crclxUnits",
            "type": "u64"
          },
          {
            "name": "nvdaxUnits",
            "type": "u64"
          },
          {
            "name": "spcxxUnits",
            "type": "u64"
          },
          {
            "name": "totalWeightBp",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "inflowRegistered",
      "docs": [
        "`lamports` is the gross amount the treasury moved; `to_ops` (the `Config.protocol_fee_bp`",
        "skim, taken before this became pot inflow) already left for `ops_wallet` — only",
        "`lamports - to_ops` was booked as epoch inflow."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "source",
            "type": "u8"
          },
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "toOps",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "inflowSource",
      "docs": [
        "§A5 inflow sources."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "b"
          },
          {
            "name": "c"
          },
          {
            "name": "d"
          },
          {
            "name": "f"
          }
        ]
      }
    },
    {
      "name": "initializeConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "opsWallet",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "otcProgram",
            "type": "pubkey"
          },
          {
            "name": "otcDeskPot",
            "type": "pubkey"
          },
          {
            "name": "deskCollection",
            "type": "pubkey"
          },
          {
            "name": "hubMint",
            "type": "pubkey"
          },
          {
            "name": "otcMint",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "docs": [
              "USDC mint for `finalize_epoch`'s two-hop price-discovery swap."
            ],
            "type": "pubkey"
          },
          {
            "name": "minPotThresholdLamports",
            "docs": [
              "0 → Appendix default (MIN_POT_THRESHOLD_LAMPORTS = 0.1 SOL)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpBuilt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pair",
            "type": "u8"
          },
          {
            "name": "hubAmount",
            "type": "u64"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpCompounded",
      "docs": [
        "`compound_lp_otc` / `compound_lp_basket`'s permissionless call — self-contained summary,",
        "mirrored by `LpBuilt`/`LpLocked` for the same deposit. Uncapped (§A5 revenue-model",
        "extension): `hub_deposited` always equals `hub_pending_before` — nothing is ever burned, the",
        "position only ever grows."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pair",
            "type": "u8"
          },
          {
            "name": "hubPendingBefore",
            "type": "u64"
          },
          {
            "name": "hubDeposited",
            "type": "u64"
          },
          {
            "name": "quoteDeposited",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpFeesHarvested",
      "docs": [
        "`harvest_lp_fees`'s permissionless call — `hub_harvested` feeds back into `pair`'s own",
        "pending compounding earmark; `quote_harvested` is credited straight into `HubPotConfig`'s",
        "matching bucket (yield flowing back to desk-holders)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pair",
            "type": "u8"
          },
          {
            "name": "hubHarvested",
            "type": "u64"
          },
          {
            "name": "quoteHarvested",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpLocked",
      "docs": [
        "Raydium CP-Swap `lock_cp_liquidity` executed right after `build_lp(HubOtc)` deposits —",
        "the LP mint is burned in the same CPI and a permanent fee-claim NFT is minted to the",
        "treasury vault PDA, so the position can never be withdrawn but keeps earning swap fees."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pair",
            "type": "u8"
          },
          {
            "name": "hubAmount",
            "type": "u64"
          },
          {
            "name": "quoteAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "lpPair",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "hubSol"
          },
          {
            "name": "hubOtc"
          },
          {
            "name": "hubCrclx"
          },
          {
            "name": "hubNvdax"
          },
          {
            "name": "hubSpcxx"
          }
        ]
      }
    },
    {
      "name": "otcBuyRecorded",
      "docs": [
        "Keeper-attested $OTC buy, reimbursed from the pot up to `otc_pending_lamports`.",
        "`otc_bought` is deposited into `otc_vault` in the same tx."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcBought",
            "type": "u64"
          },
          {
            "name": "lamportsSpent",
            "type": "u64"
          },
          {
            "name": "otcPendingAfter",
            "type": "u64"
          },
          {
            "name": "totalOtcBoughtUnits",
            "type": "u64"
          },
          {
            "name": "totalLamportsSpent",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "otcPayConfig",
      "docs": [
        "§A4.1 `[\"otc_pay\"]` — $OTC as an alternative step-fee currency. Created by the authority",
        "after `initialize_config` (no `Config` migration); absent ⇒ the path does not exist. Pricing",
        "is no longer a static authority-refreshed rate — the 2× premium is now a real synchronous",
        "on-chain Jupiter OTC→$HUB swap (dynamic, priced at the live market rate), so this config only",
        "holds the on/off switch and the dead-reserve pointer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "polAccount",
            "docs": [
              "Token account (mint = `Config.otc_mint`, owner = `[\"vault\"]` PDA) that receives every $OTC",
              "fee. Program-custodied and reserved for the $OTC/$HUB POL leg (`build_lp(HubOtc)`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "totalOtcCollected",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "otcPaymentsEnabledSet",
      "docs": [
        "Authority toggles the $OTC payment path on/off (`init_otc_payments` starts it disabled)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enabled",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "otcPotState",
      "docs": [
        "§A5 90% leg — `[\"otc_pot\"]`. Created by the authority after `initialize_config` (same",
        "no-migration pattern as `OtcPayConfig`). `otc_vault` (mint = `Config.otc_mint`, owner =",
        "`[\"pot\"]` PDA) is the program-custodied inventory `claim_yield` pays desks from.",
        "`record_otc_buy` is a keeper-attested reimbursement (mirrors `BurnState`): the keeper fronts",
        "SOL, buys $OTC on the market, deposits it into `otc_vault` in the same tx (`TransferChecked`,",
        "enforced on-chain — not merely attested), then is reimbursed from the pot up to",
        "`otc_pending_lamports`. `claim_yield` prices each desk's lamport-equivalent entitlement",
        "(`acc_per_weight` counter, unchanged) in $OTC at the lifetime average rate",
        "`total_otc_bought_units / total_lamports_spent`, so buys can batch/lag epochs without",
        "breaking per-round weight fairness."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "otcVault",
            "type": "pubkey"
          },
          {
            "name": "otcPendingLamports",
            "docs": [
              "SOL earmarked by `finalize_epoch` for $OTC buys, not yet drawn by `record_otc_buy`."
            ],
            "type": "u64"
          },
          {
            "name": "totalLamportsSpent",
            "docs": [
              "Lifetime cumulative SOL spent buying $OTC (denominator of the average rate)."
            ],
            "type": "u64"
          },
          {
            "name": "totalOtcBoughtUnits",
            "docs": [
              "Lifetime cumulative $OTC bought (numerator of the average rate)."
            ],
            "type": "u64"
          },
          {
            "name": "lastBuyTx",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rewardClaim",
      "docs": [
        "`[\"reward_claim\", round_index, asset]` — one payout per desk asset per reward round;",
        "existence is the double-payout guard (mirrors `AirdropClaim`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountUnits",
            "type": "u64"
          },
          {
            "name": "claimedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rewardRound",
      "docs": [
        "`[\"reward_round\", index]` — one `fund_treasury_reward` snapshot: `amount_units` split across",
        "the active desks' Σw (`Config.total_weight_bp`) at the moment `open_reward_round` was called.",
        "Each active desk may be paid its `amount_units × weight_bp(tier) / total_weight_bp` share",
        "exactly once per round (see `RewardClaim`); `distributed_units` is capped at `amount_units`",
        "on-chain, so the vault can never be over-drawn even if Σw drifts upward mid-round."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "amountUnits",
            "type": "u64"
          },
          {
            "name": "totalWeightBp",
            "type": "u64"
          },
          {
            "name": "distributedUnits",
            "type": "u64"
          },
          {
            "name": "claims",
            "type": "u32"
          },
          {
            "name": "openedTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "tierActivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "feeLamports",
            "type": "u64"
          },
          {
            "name": "toPot",
            "type": "u64"
          },
          {
            "name": "toOps",
            "type": "u64"
          },
          {
            "name": "hubBurnedUnits",
            "docs": [
              "$HUB base units burned outright — `tier_cost_burn_bp` of the full tier cost (`from = 0`)."
            ],
            "type": "u64"
          },
          {
            "name": "hubRewardUnits",
            "docs": [
              "$HUB base units deposited into the active-desk reward pool — the remainder of the tier",
              "cost after `hub_burned_units` (see `Config.tier_cost_burn_bp`)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tierPaidOtc",
      "docs": [
        "§A4.1 (revised) — step(s) paid in $OTC: the flat 0.5 SOL activation fee (90% pot / 10% ops,",
        "same as the SOL path — `fee_lamports`/`to_pot`/`to_ops`) plus the $OTC 2× premium, split into",
        "a swap-burn leg (real on-chain Jupiter OTC→$HUB, burned in full — this *is* the tier's $HUB",
        "cost burn, no separate direct debit from the payer's own $HUB wallet) and an equal-sized",
        "desk-pot leg (raises `OtcPotState`'s lifetime average buy rate). `from_tier == 0` is a fresh",
        "activation."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "fromTier",
            "type": "u8"
          },
          {
            "name": "toTier",
            "type": "u8"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "feeLamports",
            "type": "u64"
          },
          {
            "name": "toPot",
            "type": "u64"
          },
          {
            "name": "toOps",
            "type": "u64"
          },
          {
            "name": "otcSwapAmount",
            "docs": [
              "$OTC input to the Jupiter swap-burn leg."
            ],
            "type": "u64"
          },
          {
            "name": "hubBurnedUnits",
            "docs": [
              "$HUB received from the swap (≥ `hub_cost_delta`), `tier_cost_burn_bp` of which is burned."
            ],
            "type": "u64"
          },
          {
            "name": "hubRewardUnits",
            "docs": [
              "Remainder of the received $HUB after `hub_burned_units`, deposited into the active-desk",
              "reward pool (see `Config.tier_cost_burn_bp`)."
            ],
            "type": "u64"
          },
          {
            "name": "toOtcPot",
            "docs": [
              "Equal to `otc_swap_amount`, injected into `OtcPotState.otc_vault` (no swap)."
            ],
            "type": "u64"
          },
          {
            "name": "otcPaidTotal",
            "docs": [
              "Total $OTC charged (`otc_swap_amount + to_otc_pot`), i.e. the \"2× premium\"."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tierUpgraded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "fromTier",
            "type": "u8"
          },
          {
            "name": "toTier",
            "type": "u8"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "feeLamports",
            "type": "u64"
          },
          {
            "name": "hubBurnedUnits",
            "docs": [
              "$HUB base units burned outright — `tier_cost_burn_bp` of the `from_tier → to_tier` cost",
              "difference."
            ],
            "type": "u64"
          },
          {
            "name": "hubRewardUnits",
            "docs": [
              "$HUB base units deposited into the active-desk reward pool — the remainder of the cost",
              "difference after `hub_burned_units`."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tierVoided",
      "docs": [
        "§B3 #8 — ownership changed since activation; no refund. Pending yield is forfeited to dust."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "ownerAtActivation",
            "type": "pubkey"
          },
          {
            "name": "currentOwner",
            "type": "pubkey"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "forfeitedLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tokenomicsConfig",
      "docs": [
        "§A7.1 `[\"tokenomics\"]` — the supply allocation plan, on-chain so the dashboard and token-info",
        "submissions read one source. Created by the authority after `initialize_config` (same",
        "pattern as `OtcPayConfig`: no `Config` migration). Shares are bp of `max_supply_units`;",
        "the airdrop share is derived from the desk count at snapshot, never typed in."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "maxSupplyUnits",
            "type": "u64"
          },
          {
            "name": "airdropPerDeskUnits",
            "type": "u64"
          },
          {
            "name": "snapshotDeskCount",
            "docs": [
              "Cumulative desk assets covered by the snapshot across every round so far (0 until the",
              "first `set_airdrop_root`; never decreases once claims have started — see `snapshot_round`)."
            ],
            "type": "u32"
          },
          {
            "name": "snapshotTs",
            "type": "i64"
          },
          {
            "name": "snapshotRound",
            "docs": [
              "Number of times `set_airdrop_root` has published a changed root/desk_count. 0 = no",
              "snapshot yet; 1 = the genesis round; ≥2 = later rounds onboarding desks minted since —",
              "e.g. \"distribute the first 1,800 desks now, run round 2 once the remaining ~700 mint.\""
            ],
            "type": "u32"
          },
          {
            "name": "airdropUnits",
            "docs": [
              "`snapshot_desk_count × airdrop_per_desk_units` — exact; `airdrop_bp` is the floored share."
            ],
            "type": "u64"
          },
          {
            "name": "airdropBp",
            "type": "u16"
          },
          {
            "name": "treasuryLockBp",
            "type": "u16"
          },
          {
            "name": "teamBp",
            "type": "u16"
          },
          {
            "name": "publicBp",
            "docs": [
              "Public / OTC-launch share: whatever remains once airdrop + treasury lock + team are out."
            ],
            "type": "u16"
          },
          {
            "name": "airdropRoot",
            "docs": [
              "Merkle root over `keccak(AIRDROP_LEAF_TAG ‖ asset ‖ amount_le)`; zero until published."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "airdropVault",
            "docs": [
              "Vault-owned $HUB token account that funds claims (mint = `Config.hub_mint`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "airdropClaimedUnits",
            "type": "u64"
          },
          {
            "name": "airdropClaims",
            "type": "u32"
          },
          {
            "name": "airdropOpen",
            "type": "bool"
          },
          {
            "name": "treasuryLockVault",
            "docs": [
              "Vault-owned $HUB token account holding the genesis 2% (`YIELD_RESERVE_BP`) floor. No",
              "instruction in this program ever debits it — recorded here for on-chain provenance /",
              "dashboard display, not as a spendable balance. The treasury multisig's own float ATA is",
              "the separate, ordinary account that accumulates additional $HUB on top over time",
              "(source C claims, capped by `TREASURY_HUB_FLOAT_CAP_BP`) — this vault only ever holds the",
              "fixed initial floor."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasuryLockUnits",
            "docs": [
              "`HUB_MAX_SUPPLY_UNITS × YIELD_RESERVE_BP / BPS_DENOMINATOR`, recorded once at",
              "`init_tokenomics` for auditability (compare against `treasury_lock_vault`'s live balance)."
            ],
            "type": "u64"
          },
          {
            "name": "rewardDepositedUnits",
            "docs": [
              "Lifetime $HUB deposited into `treasury_lock_vault` by `fund_treasury_reward`, on top of",
              "the immutable `treasury_lock_units` floor — provenance only. `treasury_lock_vault`'s live",
              "balance always equals `treasury_lock_units + (reward_deposited_units -",
              "reward_distributed_units)`, since both the deposit (`TransferChecked` in) and every payout",
              "(`TransferChecked` out, capped per-round at `RewardRound.amount_units`) are enforced."
            ],
            "type": "u64"
          },
          {
            "name": "rewardDistributedUnits",
            "docs": [
              "Lifetime $HUB paid out of `treasury_lock_vault` to active desk holders via",
              "`distribute_treasury_reward`."
            ],
            "type": "u64"
          },
          {
            "name": "rewardPendingUnits",
            "docs": [
              "Deposited via `fund_treasury_reward` but not yet snapshotted into a `RewardRound`."
            ],
            "type": "u64"
          },
          {
            "name": "rewardRoundCount",
            "docs": [
              "Number of `RewardRound`s opened so far (next round's PDA index)."
            ],
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "treasuryFloatCapUpdated",
      "docs": [
        "Treasury multisig retunes the experimental float cap."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hubFloatCapBp",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "treasuryFloatInitialized",
      "docs": [
        "Authority/treasury records the vault-owned $HUB scratch, WSOL scratch, USDC scratch, and",
        "treasury-float ATAs used by the synchronous Jupiter legs (one-time, post-init — mirrors",
        "`init_otc_pot`)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultWsol",
            "type": "pubkey"
          },
          {
            "name": "vaultUsdc",
            "type": "pubkey"
          },
          {
            "name": "vaultHub",
            "type": "pubkey"
          },
          {
            "name": "treasuryFloatVault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "treasuryRewardDistributed",
      "docs": [
        "Authority-pushed payout of one active desk's tier-weighted share of an open reward round."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "amountUnits",
            "type": "u64"
          },
          {
            "name": "roundDistributedUnits",
            "type": "u64"
          },
          {
            "name": "claims",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "treasuryRewardFunded",
      "docs": [
        "§A6.3 bridge — treasury deposits $HUB (swapped off-chain from the OTC launcher's",
        "holders-in-stock reward leg) into `treasury_lock_vault`, earmarked for the next",
        "`open_reward_round`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hubAmount",
            "type": "u64"
          },
          {
            "name": "pendingAfter",
            "type": "u64"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "treasuryRewardRoundOpened",
      "docs": [
        "Permissionless snapshot: `amount_units` split across the active desks' Σw at this moment."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "round",
            "type": "u32"
          },
          {
            "name": "amountUnits",
            "type": "u64"
          },
          {
            "name": "totalWeightBp",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "treasuryState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "multisig",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "Program-signed custody PDA (`[\"vault\"]`) for treasury-side token positions (LP, §A6.2)."
            ],
            "type": "pubkey"
          },
          {
            "name": "desksOwned",
            "type": "u32"
          },
          {
            "name": "sweepBudgetCapBp",
            "type": "u16"
          },
          {
            "name": "sweepPaybackCapLamports",
            "type": "u64"
          },
          {
            "name": "exitDiscountBp",
            "type": "u16"
          },
          {
            "name": "exitHubLegBp",
            "type": "u16"
          },
          {
            "name": "floorStalenessBp",
            "type": "u16"
          },
          {
            "name": "hubFloatCapBp",
            "type": "u16"
          },
          {
            "name": "totalExits",
            "type": "u32"
          },
          {
            "name": "totalSweeps",
            "type": "u32"
          },
          {
            "name": "lpPendingHubUnits",
            "docs": [
              "§A5 2.5% leg — lifetime $HUB swapped-in and earmarked for the $HUB/$OTC LP at every",
              "`finalize_epoch`; audit/informational running total (mirrors the pre-swap",
              "`lp_pending_lamports` field it replaces), physically sitting in `vault_hub` until",
              "`build_lp_otc_locked` draws it via CPI."
            ],
            "type": "u64"
          },
          {
            "name": "vaultHub",
            "docs": [
              "Vault-owned (`[\"vault\"]` PDA) $HUB scratch ATA: the Jupiter swap destination for both the",
              "`finalize_epoch` round-split leg and the `otc_pay.rs` 2× premium swap-burn leg, and the",
              "physical custody for `lp_pending_hub_units` until `build_lp_otc_locked` draws it. Set by",
              "`init_treasury_float`."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultWsol",
            "docs": [
              "Vault-owned (`[\"vault\"]` PDA) WSOL scratch ATA used only by `finalize_epoch`'s SOL→$HUB",
              "leg (wrapped via System transfer + `SyncNative` immediately before the Jupiter CPI). Set",
              "by `init_treasury_float`."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultUsdc",
            "docs": [
              "Vault-owned (`[\"vault\"]` PDA) USDC scratch ATA — the intermediate hop of `finalize_epoch`'s",
              "two-hop price-discovery swap (WSOL→USDC destination, USDC→$HUB source; mint =",
              "`Config.usdc_mint`). Balance must return to (near) zero within one instruction — both hops",
              "execute synchronously. Set by `init_treasury_float`."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasuryFloatVault",
            "docs": [
              "Vault-owned (`[\"vault\"]` PDA) $HUB buy-and-hold ATA (§A6.3/§A7.1 \"source C\" float,",
              "distinct from `TokenomicsConfig.treasury_lock_vault`'s immutable genesis floor) — the",
              "`finalize_epoch` treasury-float leg's destination, capped at `hub_float_cap_bp` of supply;",
              "excess at deposit time is burned instead. Set by `init_treasury_float`."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasuryFloatUnits",
            "docs": [
              "Lifetime $HUB deposited into `treasury_float_vault` — compared against",
              "`HUB_MAX_SUPPLY_UNITS × hub_float_cap_bp / BPS_DENOMINATOR` at every deposit."
            ],
            "type": "u64"
          },
          {
            "name": "lpHubSolActive",
            "docs": [
              "§A6.2 — one position per pair, HODL both legs."
            ],
            "type": "bool"
          },
          {
            "name": "lpHubOtcActive",
            "type": "bool"
          },
          {
            "name": "lpHubDeposited",
            "type": "u64"
          },
          {
            "name": "lpQuoteDeposited",
            "type": "u64"
          },
          {
            "name": "lpBasketActive",
            "docs": [
              "§A5.1 extension — MemeStock basket LP beyond HUB/OTC, indexed by",
              "`LpPair::basket_index()` (Crclx=0, Nvdax=1, Spcxx=2 — i.e. CRCLx/NVDAx/SPCXx). Mirrors the 4 fields above",
              "exactly, generalized to an array so one compounder ix (`compound_lp_basket`) threshold-gates",
              "and deposits all three pairs. `lp_basket_pending_hub_units` is fed by `harvest_lp_fees`'",
              "HUB-side yield leg (there is no `finalize_epoch` earmark for these pairs — unlike HUB/OTC,",
              "they are seeded once via `build_lp_basket_locked` and grow only from their own fee yield)."
            ],
            "type": {
              "array": [
                "bool",
                3
              ]
            }
          },
          {
            "name": "lpBasketPendingHubUnits",
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          },
          {
            "name": "lpBasketHubDeposited",
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          },
          {
            "name": "lpBasketQuoteDeposited",
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "yieldClaimed",
      "docs": [
        "One claim settles every round closed since the tier's stamp. `lamports` is the",
        "lamport-equivalent entitlement settled; `otc_paid` is what actually left the vault, priced",
        "at the pot's lifetime average buy rate at the moment of this claim."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "asset",
            "type": "pubkey"
          },
          {
            "name": "claimer",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "otcPaid",
            "type": "u64"
          },
          {
            "name": "accPerWeight",
            "type": "u128"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "seedsDoc",
      "type": "string",
      "value": "\"config|epoch+u64|tier+asset|pot|burn|otc_pot|creator_fee|treasury|vault|otc_pay|tokenomics|airdrop+asset|reward_round+u32|reward_claim+u32+asset|hub_pot|hub_pot_round+u32|hub_pot_claim+u32+asset\""
    }
  ]
};
