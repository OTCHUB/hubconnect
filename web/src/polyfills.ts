import { Buffer } from "buffer";

// anchor + the sdk's PDA helpers expect a Node-style global Buffer.
const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
