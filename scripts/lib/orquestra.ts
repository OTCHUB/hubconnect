// Minimal Orquestra client (https://mintlify.wiki/berkayoztunc/orquestra). Orquestra indexes an
// Anchor IDL into REST transaction builders + docs; it never holds keys — `build` returns an
// unsigned instruction that we sign locally and send through our own RPC.
//
// Auth (from .env):  ORQUESTRA_TOKEN   JWT from the dashboard session (7-day) — IDL upload/update
//                    ORQUESTRA_API_KEY project-scoped `b58_…` key            — build/instructions
//                    ORQUESTRA_API_URL default https://api.orquestra.dev
//                    ORQUESTRA_PROJECT_ID optional; else resolved from the program ID
import "dotenv/config";
import { utils } from "@anchor-lang/core";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { devnetRpc } from "./devnet";

export const ORQUESTRA_URL = (process.env.ORQUESTRA_API_URL || "https://api.orquestra.dev").replace(
  /\/+$/,
  "",
);

export type OrquestraProject = { id: string; name: string; slug?: string; programId?: string };

export type BuiltInstruction = {
  transaction: string;
  message?: string;
  estimatedFee?: number;
  instruction: {
    name: string;
    programId: string;
    data: string;
    accounts: { name: string; pubkey: string; isSigner: boolean; isWritable: boolean }[];
  };
};

/** Bearer JWT for owner endpoints, X-API-Key for project endpoints; both when both are set. */
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (process.env.ORQUESTRA_TOKEN) h.authorization = `Bearer ${process.env.ORQUESTRA_TOKEN}`;
  if (process.env.ORQUESTRA_API_KEY) h["x-api-key"] = process.env.ORQUESTRA_API_KEY;
  return h;
}

export const hasOrquestraAuth = () =>
  !!(process.env.ORQUESTRA_TOKEN || process.env.ORQUESTRA_API_KEY);

export class OrquestraError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    path: string,
  ) {
    super(`orquestra ${status} ${path}: ${JSON.stringify(body).slice(0, 400)}`);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ORQUESTRA_URL}${path}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) throw new OrquestraError(res.status, json, path);
  return json as T;
}

/** GET /api/projects/by-program/:programId → project, or null when none is indexed yet. */
export async function findProject(programId: PublicKey): Promise<OrquestraProject | null> {
  if (process.env.ORQUESTRA_PROJECT_ID) {
    return { id: process.env.ORQUESTRA_PROJECT_ID, name: "(ORQUESTRA_PROJECT_ID)" };
  }
  try {
    const r = await api<{ project: OrquestraProject }>(
      "GET",
      `/api/projects/by-program/${programId.toBase58()}`,
    );
    return r.project ?? null;
  } catch (e) {
    if (e instanceof OrquestraError && e.status === 404) return null;
    throw e;
  }
}

export type UploadArgs = {
  name: string;
  programId: PublicKey;
  idl: unknown;
  description?: string;
  cpiMd?: string;
  isPublic?: boolean;
};

/** POST /api/idl/upload (JWT). 409 → project exists; caller should `updateIdl` instead. */
export const uploadIdl = (a: UploadArgs) =>
  api<{ project: OrquestraProject; idl: { version: number; instructionCount: number } }>(
    "POST",
    "/api/idl/upload",
    { ...a, programId: a.programId.toBase58(), isPublic: a.isPublic ?? true },
  );

/** PUT /api/idl/:projectId (JWT, owner) — new IDL version; previous versions are kept. */
export const updateIdl = (projectId: string, idl: unknown, cpiMd?: string) =>
  api<{ version: number; instructionCount: number; warnings?: string[] }>(
    "PUT",
    `/api/idl/${projectId}`,
    { idl, cpiMd },
  );

/**
 * POST /api/:projectId/instructions/:name/build → the encoded instruction. We ignore the
 * pre-serialized `transaction` (Orquestra's blockhash/fee-payer) and rebuild a
 * TransactionInstruction from `instruction.data` + accounts so it slots into `sendIxs`.
 */
export async function buildInstruction(
  projectId: string,
  name: string,
  accounts: Record<string, PublicKey | string>,
  args: Record<string, unknown>,
  feePayer: PublicKey,
  network: "devnet" | "mainnet-beta" | string = "devnet",
): Promise<{ ix: TransactionInstruction; raw: BuiltInstruction }> {
  const raw = await api<BuiltInstruction>("POST", `/api/${projectId}/instructions/${name}/build`, {
    accounts: Object.fromEntries(Object.entries(accounts).map(([k, v]) => [k, v.toString()])),
    args,
    feePayer: feePayer.toBase58(),
    network,
  });
  const ins = raw.instruction;
  if (!ins?.data || !ins.accounts) throw new Error(`build response lacks instruction: ${raw}`);
  const ix = new TransactionInstruction({
    programId: new PublicKey(ins.programId),
    keys: ins.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: decodeData(ins.data),
  });
  return { ix, raw };
}

/** Docs say hex; the official CLI also tolerates base58/base64, so accept all three. */
export function decodeData(s: string): Buffer {
  const hex = s.replace(/^0x/, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) return Buffer.from(hex, "hex");
  try {
    return Buffer.from(utils.bytes.bs58.decode(s));
  } catch {
    return Buffer.from(s, "base64");
  }
}

/** RPC for the active cluster (IDL sync is cluster-agnostic but the hash check is not). */
export function clusterRpc(): string {
  const cluster = process.env.HUB_CLUSTER || "devnet";
  if (cluster === "devnet") return devnetRpc();
  const url = process.env.HUB_RPC_URL?.replace(/\$\{(\w+)\}/g, (_, v) => process.env[v] ?? "");
  // .env's HUB_RPC_URL is normally the devnet endpoint; never let it stand in for mainnet.
  if (url && !/devnet/i.test(url)) return url;
  return process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";
}
