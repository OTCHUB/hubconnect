//! Metaplex Core helpers: on-chain ownership/collection verification (§B3 #2/#5/#11)
//! and the `TransferV1` CPI used by consignment. Reads the fixed `AssetV1` prefix
//! (key u8 | owner 32 | update_authority tag u8 [+ pubkey 32]) directly — no mpl-core
//! crate dependency, so the toolchain pin stays minimal.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};

use crate::constants::*;
use crate::errors::HubError;

pub struct CoreAssetView {
    pub owner: Pubkey,
    pub collection: Option<Pubkey>,
}

/// Verifies `asset` is a Core `AssetV1` and returns its owner + collection.
pub fn read_asset(asset: &AccountInfo) -> Result<CoreAssetView> {
    require_keys_eq!(*asset.owner, MPL_CORE_ID, HubError::NotCoreAsset);
    let data = asset.try_borrow_data()?;
    require!(
        data.len() >= 34 && data[0] == CORE_KEY_ASSET_V1,
        HubError::NotCoreAsset
    );
    let owner = Pubkey::new_from_array(data[1..33].try_into().unwrap());
    let collection = if data[33] == CORE_UA_COLLECTION {
        require!(data.len() >= 66, HubError::NotCoreAsset);
        Some(Pubkey::new_from_array(data[34..66].try_into().unwrap()))
    } else {
        None
    };
    Ok(CoreAssetView { owner, collection })
}

/// Asset must belong to `config.desk_collection` (§A2: desks are one Core collection).
pub fn require_desk(asset: &AccountInfo, desk_collection: &Pubkey) -> Result<CoreAssetView> {
    let view = read_asset(asset)?;
    require!(
        view.collection.as_ref() == Some(desk_collection),
        HubError::WrongCollection
    );
    Ok(view)
}

/// `TransferV1 { compression_proof: None }` — optional accounts use the Core program id
/// as the "absent" placeholder, matching the Metaplex client convention.
#[allow(clippy::too_many_arguments)]
pub fn transfer_v1<'info>(
    mpl_core: &AccountInfo<'info>,
    asset: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    require_keys_eq!(*mpl_core.key, MPL_CORE_ID, HubError::NotCoreAsset);
    let ix = Instruction {
        program_id: MPL_CORE_ID,
        accounts: vec![
            AccountMeta::new(*asset.key, false),
            AccountMeta::new_readonly(*collection.key, false),
            AccountMeta::new(*payer.key, true),
            AccountMeta::new_readonly(*authority.key, true),
            AccountMeta::new_readonly(*new_owner.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
            AccountMeta::new_readonly(MPL_CORE_ID, false),
        ],
        data: vec![CORE_IX_TRANSFER_V1, 0],
    };
    invoke_signed(
        &ix,
        &[
            asset.clone(),
            collection.clone(),
            payer.clone(),
            authority.clone(),
            new_owner.clone(),
            system_program.clone(),
            mpl_core.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}
