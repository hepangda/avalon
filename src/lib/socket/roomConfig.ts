import {
  recommendedOptions,
  rejectionLimit,
  speechDuration,
} from "@/lib/engine";
import type { RoomConfig } from "./types";

/** Resolve recommendations from occupied seats, never placeholder roster size. */
export function resolveRoomConfig(
  config: RoomConfig,
  seatedCount: number,
): RoomConfig {
  if (!config.useRecommended) return config;
  const count = Math.max(5, Math.min(10, seatedCount));
  return {
    ...config,
    options: {
      ...recommendedOptions(count),
      maxRejections: rejectionLimit(undefined),
      speechSeconds: speechDuration(undefined),
    },
  };
}
