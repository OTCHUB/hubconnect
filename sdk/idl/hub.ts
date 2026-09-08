/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/hub.json`.
 */
export type Hub = {
  "address": "3S2K4q9Kk9xkSSjqDb5jgp1cGC3mbqU2NfpCa3wJateL",
  "metadata": {
    "name": "hub",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "$HUB protocol — stake-to-earn layer for OTC desk NFTs (community tooling)"
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
        "§A4.1 #16 — `activate_tier` paid in $OTC at the 2× premium; proceeds → POL reserve."
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
          "name": "otcMint"
        },
        {
          "name": "payerOtc",
          "writable": true
        },
        {
          "name": "polAccount",
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
          "name": "tokenProgram"
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
          "name": "tokenProgram"
        }
      ],
      "args": []
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
          "name": "tokenProgram"
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
        "§B3 #4"
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
            "threshold is met (they pay the next Epoch account's rent)."
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "epochIndex",
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
      "name": "recordBurn",
      "docs": [
        "§B3 #7"
      ],
      "discriminator": [
        254,
        128,
        98,
        33,
        0,
        74,
        165,
        252
      ],
      "accounts": [
        {
          "name": "keeper",
          "docs": [
            "Must be `burn.authority`: fronts SOL for the market buy, reimbursed here on proof of burn."
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
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "hubBurned",
          "type": "u64"
        },
        {
          "name": "lamportsSpent",
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
          "name": "tokenProgram"
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
          "name": "tokenProgram"
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
      "name": "setOtcRate",
      "docs": [
        "§A4.1 #15 — authority refreshes the $OTC/SOL reference rate and the enable switch."
      ],
      "discriminator": [
        97,
        190,
        198,
        119,
        23,
        18,
        202,
        143
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
          "name": "otcPerSol",
          "type": "u64"
        },
        {
          "name": "enabled",
          "type": "bool"
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
        "§A4.1 #17 — `upgrade_tier` paid in $OTC at the 2× premium; proceeds → POL reserve."
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
          "name": "otcMint"
        },
        {
          "name": "payerOtc",
          "writable": true
        },
        {
          "name": "polAccount",
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
        }
      ],
      "args": [
        {
          "name": "targetTier",
          "type": "u8"
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
      "name": "burnRecorded",
      "discriminator": [
        217,
        168,
        29,
        198,
        28,
        67,
        77,
        142
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
      "name": "otcRateSet",
      "discriminator": [
        74,
        104,
        139,
        74,
        54,
        196,
        74,
        213
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
      "name": "burnExceedsPending",
      "msg": "Burn spend exceeds burn-pending"
    },
    {
      "code": 6015,
      "name": "lpPositionExists",
      "msg": "LP position for this pair already exists (one per pair)"
    },
    {
      "code": 6016,
      "name": "tierVoided",
      "msg": "Tier has been voided by an ownership change; re-activate"
    },
    {
      "code": 6017,
      "name": "notDeskOwner",
      "msg": "Caller does not own the desk asset"
    },
    {
      "code": 6018,
      "name": "wrongCollection",
      "msg": "Desk asset does not belong to the configured collection"
    },
    {
      "code": 6019,
      "name": "potBelowThreshold",
      "msg": "Open epoch inflow is below min_pot_threshold_lamports"
    },
    {
      "code": 6020,
      "name": "epochAlreadyFinalized",
      "msg": "Epoch already finalized"
    },
    {
      "code": 6021,
      "name": "epochNotFinalized",
      "msg": "Epoch is not finalized"
    },
    {
      "code": 6022,
      "name": "nothingToClaim",
      "msg": "Nothing to claim"
    },
    {
      "code": 6023,
      "name": "potBelowLiability",
      "msg": "Pot lamports below liability"
    },
    {
      "code": 6024,
      "name": "invariantViolated",
      "msg": "Inflow accounting invariant violated"
    },
    {
      "code": 6025,
      "name": "lpDisabled",
      "msg": "LP building is disabled"
    },
    {
      "code": 6026,
      "name": "lpPhase2Gated",
      "msg": "HUB/OTC LP is gated until phase-2 conditions hold"
    },
    {
      "code": 6027,
      "name": "floorStale",
      "msg": "Floor moved more than the staleness guard since tx build"
    },
    {
      "code": 6028,
      "name": "treasurySelfDeal",
      "msg": "Treasury may not buy its own exit"
    },
    {
      "code": 6029,
      "name": "burnPendingUnderflow",
      "msg": "Burn-pending underflow"
    },
    {
      "code": 6030,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6031,
      "name": "otcPaymentsDisabled",
      "msg": "$OTC payments are disabled"
    },
    {
      "code": 6032,
      "name": "otcRateStale",
      "msg": "$OTC reference rate is stale; authority must refresh it"
    },
    {
      "code": 6033,
      "name": "invalidTokenAccount",
      "msg": "Account is not an SPL token account for the expected mint/owner"
    },
    {
      "code": 6034,
      "name": "wrongTokenProgram",
      "msg": "Token program does not match the configured mint"
    },
    {
      "code": 6035,
      "name": "allocationExceedsSupply",
      "msg": "Airdrop + treasury lock + team allocations exceed the max supply"
    },
    {
      "code": 6036,
      "name": "airdropClosed",
      "msg": "Airdrop claims are not open"
    },
    {
      "code": 6037,
      "name": "airdropInvalidProof",
      "msg": "Merkle proof does not match the published airdrop root"
    },
    {
      "code": 6038,
      "name": "airdropLocked",
      "msg": "Airdrop root cannot change once claims have been paid"
    },
    {
      "code": 6039,
      "name": "notImplemented",
      "msg": "Not implemented in this milestone"
    },
    {
      "code": 6040,
      "name": "otcBuyExceedsPending",
      "msg": "OTC buy spend exceeds otc_pending_lamports"
    },
    {
      "code": 6041,
      "name": "noOtcPurchased",
      "msg": "No $OTC has been purchased yet; nothing claimable"
    },
    {
      "code": 6042,
      "name": "creatorFeeBelowThreshold",
      "msg": "Creator-fee pending balance is below the clearing threshold"
    },
    {
      "code": 6043,
      "name": "creatorFeeLegExceedsPending",
      "msg": "Creator-fee leg draw exceeds that leg's pending balance"
    },
    {
      "code": 6044,
      "name": "lpAccountsMissing",
      "msg": "build_lp requires AMM CPI accounts in remaining_accounts"
    },
    {
      "code": 6045,
      "name": "airdropCapExceeded",
      "msg": "Airdrop snapshot desk count exceeds the 2,500-desk cap"
    },
    {
      "code": 6046,
      "name": "noRewardPending",
      "msg": "No treasury reward pending; call fund_treasury_reward first"
    },
    {
      "code": 6047,
      "name": "rewardRoundExceeded",
      "msg": "Reward round payout would exceed the round's snapshotted amount"
    },
    {
      "code": 6048,
      "name": "deskNotActive",
      "msg": "Desk is not an active tier holder"
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
      "name": "burnRecorded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hubBurned",
            "type": "u64"
          },
          {
            "name": "lamportsSpent",
            "type": "u64"
          },
          {
            "name": "burnPendingAfter",
            "type": "u64"
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
            "name": "burnPendingLamports",
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
            "name": "tierHubCostUnits",
            "docs": [
              "$HUB base units required to reach each tier from scratch (cumulative table)."
            ],
            "type": {
              "array": [
                "u64",
                4
              ]
            }
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
              "§A5 5%: earmarked at finalize into `TreasuryState.lp_pending_lamports` for the",
              "$HUB/$OTC LP (phase-2 `build_lp`). Remainder after burn + lp is the 90% $OTC leg."
            ],
            "type": "u16"
          },
          {
            "name": "opsPctBp",
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
            "name": "burnPctBp"
          },
          {
            "name": "lpPctBp"
          },
          {
            "name": "opsPctBp"
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
              "Replay guard for `record_creator_fee_burn_result` (trust-attested like `record_burn`)."
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
            "type": "u64"
          },
          {
            "name": "lpPendingLamports",
            "docs": [
              "§A5 5% — this round's LP-build earmark, added to `TreasuryState.lp_pending_lamports`."
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
            "type": "u64"
          },
          {
            "name": "lpPendingLamports",
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
      "name": "inflowRegistered",
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
          }
        ]
      }
    },
    {
      "name": "otcBuyRecorded",
      "docs": [
        "Keeper-attested $OTC buy, reimbursed from the pot up to `otc_pending_lamports` (mirrors",
        "`BurnRecorded`). `otc_bought` is deposited into `otc_vault` in the same tx."
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
        "after `initialize_config` (no `Config` migration); absent ⇒ the path does not exist."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "otcPerSol",
            "docs": [
              "Reference rate: $OTC base units per 1 SOL, refreshed by the authority (`set_otc_rate`)."
            ],
            "type": "u64"
          },
          {
            "name": "rateTs",
            "type": "i64"
          },
          {
            "name": "premiumBp",
            "docs": [
              "Premium over the SOL step-fee value (bp). Written from `OTC_PREMIUM_BP`, never updated."
            ],
            "type": "u16"
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
      "name": "otcRateSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "otcPerSol",
            "type": "u64"
          },
          {
            "name": "enabled",
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
              "$HUB base units burned to reach `tier` (the full tier cost; `from = 0`)."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "tierPaidOtc",
      "docs": [
        "§A4.1 — step(s) paid in $OTC at the 2× premium; nothing enters the pot, the $OTC lands in the",
        "POL reserve. `from_tier == 0` is a fresh activation. `hub_burned_units` is paid separately —",
        "the $HUB tier cost is always burned, on both the SOL and $OTC fee paths."
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
            "name": "solEquivalentLamports",
            "type": "u64"
          },
          {
            "name": "otcPaid",
            "type": "u64"
          },
          {
            "name": "otcPerSol",
            "type": "u64"
          },
          {
            "name": "premiumBp",
            "type": "u16"
          },
          {
            "name": "hubBurnedUnits",
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
              "$HUB base units burned for `from_tier → to_tier` (the cost difference)."
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
            "name": "lpPendingLamports",
            "docs": [
              "§A5 5% leg, earmarked at every `finalize_epoch`; drawn down once the phase-2 LP adapter",
              "lands (mirrors `BurnState.burn_pending_lamports`'s keeper-draw pattern)."
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
      "value": "\"config|epoch+u64|tier+asset|pot|burn|otc_pot|creator_fee|treasury|vault|otc_pay|tokenomics|airdrop+asset|reward_round+u32|reward_claim+u32+asset\""
    }
  ]
};
