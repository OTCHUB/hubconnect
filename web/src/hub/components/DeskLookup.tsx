import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { parsePubkey } from "../hooks/useDeskTier";

const inputCls =
  "flex-1 border border-green-500/30 bg-black px-2 py-1 text-xs text-green-300 outline-none focus:border-green-400";

/** Asset-id search box; rendered on the index route so `desk/:asset` resolves under the mount. */
export function DeskLookup() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = parsePubkey(value);
    if (!key) return setErr("not a valid base58 pubkey");
    setErr(null);
    navigate(`desk/${key.toBase58()}`);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <span className="text-xs text-green-600">C:\HUB&gt;</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="desk asset id (MPL Core)"
          spellCheck={false}
          className={inputCls}
        />
        <button
          type="submit"
          className="border border-green-500/40 px-3 text-xs text-green-300 hover:bg-green-500/10"
        >
          LOOKUP
        </button>
      </div>
      {err && <div className="text-[10px] text-red-400">{err}</div>}
    </form>
  );
}
