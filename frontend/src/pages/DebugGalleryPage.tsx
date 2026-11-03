import { loadEngine } from "@/lib/debug/rustEngine";
import {
SCENARIOS
} from "@/lib/debug/scenarios";
import { use } from "react";
import { useSearchParams } from "react-router-dom";
import "@/styles/debug-gallery.css";

import { GallerySession } from '@/components/debug/GallerySession';

// Scenes and actions run on the Rust rules engine, built on request by Vite.
const engine = loadEngine();

export default function DebugGalleryPage() {
  use(engine);
  const [params, setParams] = useSearchParams();
  const scenario =
    SCENARIOS.find((s) => s.id === params.get("scene")) ?? SCENARIOS[1]!;
  const requested = Number(params.get("players") ?? 7);
  const count =
    Number.isInteger(requested) && requested >= 5 && requested <= 10
      ? requested
      : 7;
  const players =
    "minPlayers" in scenario ? Math.max(scenario.minPlayers, count) : count;
  return (
    <GallerySession
      key={`${scenario.id}-${players}`}
      scenarioId={scenario.id}
      playerCount={players}
      viewerParam={params.get("view")}
      onSelect={(scene, size, view) => {
        setParams({ scene, players: String(size), ...(view ? { view } : {}) });
      }}
    />
  );
}
