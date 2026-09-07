import type { ReactNode } from "react";
import type { ProtocolState } from "@hub-sdk";
import { useProtocolState } from "../hooks/useProtocolState";
import { ErrorBox, LoadingBox, UninitializedBox } from "./ui/StateBox";

type Props = { children: (state: ProtocolState, fetchedAt: number) => ReactNode };

/** Resolves loading / uninitialized / error once so every page renders the same fallbacks. */
export function ProtocolGate({ children }: Props) {
  const { status } = useProtocolState();
  switch (status.kind) {
    case "loading":
      return <LoadingBox />;
    case "uninitialized":
      return <UninitializedBox />;
    case "error":
      return <ErrorBox message={status.message} />;
    case "ready":
      return <>{children(status.state, status.fetchedAt)}</>;
  }
}
