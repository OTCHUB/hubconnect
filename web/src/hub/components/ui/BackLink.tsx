import { Link } from "react-router-dom";

/** Route-relative `..` — lands on the HubRoutes index wherever the module is mounted. */
export function BackLink() {
  return (
    <Link to=".." relative="route" className="text-[10px] text-green-600 hover:text-green-300">
      ← dashboard
    </Link>
  );
}
