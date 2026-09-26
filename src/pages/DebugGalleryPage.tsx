import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslations } from "use-intl";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { GameView } from "./GamePage";
import { useRoleText } from "@/lib/game/useRoleText";
import {
  canStartAssassination,
  projectStateForViewer,
  type GameEvent,
  type GameState,
} from "@/lib/engine";
import type { gameActions } from "@/lib/socket/client";
import type { Ack } from "@/lib/socket/types";
import {
  applyEvent,
  buildScenario,
  completeMission,
  completeVotes,
  propose,
  SCENARIOS,
  type ScenarioId,
} from "@/lib/debug/scenarios";
import "./debug-gallery.css";

export default function DebugGalleryPage() {
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

function GallerySession({
  scenarioId,
  playerCount,
  viewerParam,
  onSelect,
}: {
  scenarioId: ScenarioId;
  playerCount: number;
  viewerParam: string | null;
  onSelect: (scene: ScenarioId, count: number, view?: string) => void;
}) {
  const t = useTranslations();
  const roleText = useRoleText();
  const initial = useMemo(
    () => buildScenario(scenarioId, playerCount),
    [scenarioId, playerCount],
  );
  const [state, setState] = useState(initial.state);
  const stateRef = useRef(state);
  const [viewerId, setViewerId] = useState(initial.viewerId);
  const [history, setHistory] = useState<
    Array<{ state: GameState; viewerId: string; openSeat?: string }>
  >([]);
  const [revision, setRevision] = useState(0);
  const [connected, setConnected] = useState(scenarioId !== "reconnecting");
  const [latency, setLatency] = useState(42);
  const [failNext, setFailNext] = useState(false);
  const [fails, setFails] = useState(1);
  const [openSeat, setOpenSeat] = useState(initial.openSeatId);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState("");
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setViewerId(
      viewerParam === "spectator" ||
        initial.state.players.some((p) => p.id === viewerParam)
        ? viewerParam!
        : initial.viewerId,
    );
  }, [viewerParam, initial]);

  function cancelTransition() {
    if (transitionTimer.current !== null) clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
  }
  function commit(next: GameState) {
    cancelTransition();
    const previous = { state: stateRef.current, viewerId, openSeat };
    setHistory((items) => [...items.slice(-39), previous]);
    stateRef.current = next;
    setState(next);
    setError(null);
  }
  useEffect(() => {
    if (initial.nextState) {
      transitionTimer.current = setTimeout(() => {
        const previous = {
          state: stateRef.current,
          viewerId: initial.viewerId,
          openSeat: initial.openSeatId,
        };
        stateRef.current = initial.nextState!;
        setHistory((items) => [...items, previous]);
        setState(initial.nextState!);
      }, 450);
    }
    return cancelTransition;
  }, [initial, revision]);

  function changeViewer(id: string) {
    setViewerId(id);
    onSelect(scenarioId, playerCount, id);
  }
  function reset() {
    cancelTransition();
    stateRef.current = initial.state;
    setState(initial.state);
    setHistory([]);
    setOpenSeat(initial.openSeatId);
    setError(null);
    setFailNext(false);
    setConnected(scenarioId !== "reconnecting");
    setLatency(42);
    setFails(1);
    setCopied(false);
    setRevision((v) => v + 1);
  }
  function run(transform: (current: GameState) => GameState) {
    if (!connected) return;
    try {
      commit(transform(stateRef.current));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function dispatch(event: GameEvent): Promise<Ack> {
    if (!connected)
      return {
        ok: false,
        error: { code: "DISCONNECTED", message: t("debug.disconnected") },
      };
    if (failNext) {
      setFailNext(false);
      return {
        ok: false,
        error: { code: "DEBUG_ERROR", message: t("debug.simulatedError") },
      };
    }
    try {
      commit(applyEvent(stateRef.current, event));
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: { code: "ENGINE_ERROR", message: (e as Error).message },
      };
    }
  }
  const actions: typeof gameActions = {
    ackRole: (roleRevision = 0) => dispatch({ type: "ACK_ROLE", by: viewerId, roleRevision }),
    proposeTeam: (team) =>
      dispatch({ type: "PROPOSE_TEAM", by: viewerId, team }),
    finalizeTeam: (team) => dispatch({ type: 'FINALIZE_TEAM', by: viewerId, team }),
    startDiscussion: () => dispatch({ type: 'START_DISCUSSION', by: viewerId }),
    endSpeech: () => dispatch({ type: 'END_SPEECH', by: viewerId }),
    vote: (value) => dispatch({ type: "CAST_VOTE", by: viewerId, value }),
    missionCard: (card) =>
      dispatch({ type: "CAST_MISSION_CARD", by: viewerId, card }),
    useLady: (target) => dispatch({ type: "USE_LADY", by: viewerId, target }),
    startAssassination: () =>
      dispatch({ type: "START_ASSASSINATION", by: viewerId }),
    assassinate: (target) =>
      dispatch({ type: "ASSASSINATE", by: viewerId, target }),
  };
  const game = useMemo(() => {
    const projected = projectStateForViewer(state, viewerId);
    return {
      ...projected,
      serverTime: 1_800_000_000_000 + state.logSeq * 1000,
      players: projected.players.map((p) => ({
        ...p,
        claimed: p.id !== openSeat,
        connected: p.id !== openSeat && p.connected,
        latency: p.id === viewerId ? latency : 25 + p.seat * 19,
      })),
    };
  }, [state, viewerId, openSeat, latency]);
  const quickActions = (
    <div className="debug-actions">
      {state.phase === "TeamBuilding" && (
        <button disabled={!connected} onClick={() => run((s) => propose(s, false))}>
          {t("debug.autoTeam")}
        </button>
      )}
      {state.phase === "Voting" && (
        <>
          <button
            disabled={!connected}
            onClick={() => run((s) => completeVotes(s, "approve"))}
          >
            {t("debug.approveRest")}
          </button>
          <button
            disabled={!connected}
            onClick={() => run((s) => completeVotes(s, "reject"))}
          >
            {t("debug.rejectRest")}
          </button>
        </>
      )}
      {state.phase === "MissionVote" && (
        <>
          <label>
            {t("debug.failCount")}
            <select
              value={fails}
              onChange={(e) => setFails(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!connected}
            onClick={() => run((s) => completeMission(s, fails))}
          >
            {t("debug.submitRest")}
          </button>
          <p>{t("debug.legalCards")}</p>
        </>
      )}
      {state.phase === "LadyOfLake" && (
        <button onClick={() => changeViewer(state.ladyHolderId!)}>
          {t("debug.viewHolder")}
        </button>
      )}
      {state.phase === "Assassination" && (
        <button onClick={() => changeViewer(state.assassinId!)}>
          {t("debug.viewAssassin")}
        </button>
      )}
      {canStartAssassination(state) && (
        <button
          disabled={!connected}
          onClick={() =>
            run((s) =>
              applyEvent(s, { type: "START_ASSASSINATION", by: s.assassinId! }),
            )
          }
        >
          {t("debug.startAssassination")}
        </button>
      )}
      {state.phase === "GameOver" && (
        <button onClick={reset}>{t("debug.reset")}</button>
      )}
    </div>
  );
  const groups = [...new Set(SCENARIOS.map((s) => s.group))];
  const matching = SCENARIOS.filter((s) =>
    t(`debug.scenes.${s.id}.title`)
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  return (
    <div className="debug-gallery">
      <aside className="debug-controls" aria-label={t("debug.controls")}>
        <header className="debug-heading">
          <div>
            <Link href="/">← AVALON</Link>
            <LocaleSwitcher />
          </div>
          <h1>Debug gallery</h1>
          <p>{t("debug.subtitle")}</p>
        </header>
        <div className="debug-settings">
          <label>
            {t("debug.playerCount")}
            <select
              value={playerCount}
              onChange={(e) => onSelect(scenarioId, Number(e.target.value))}
            >
              {[5, 6, 7, 8, 9, 10].map((n) => (
                <option
                  value={n}
                  key={n}
                  disabled={scenarioId === "twoFails" && n < 7}
                >
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("debug.perspective")}
            <select
              value={viewerId}
              onChange={(e) => changeViewer(e.target.value)}
            >
              <option value="spectator">{t("game.spectating")}</option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.seat + 1}. {p.name} · {roleText.name(p.role)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="debug-toolbar">
          <button onClick={reset}>{t("debug.reset")}</button>
          <button
            disabled={!history.length}
            onClick={() => {
              cancelTransition();
              const previous = history.at(-1)!;
              stateRef.current = previous.state;
              setState(previous.state);
              setOpenSeat(previous.openSeat);
              changeViewer(previous.viewerId);
              setHistory((items) => items.slice(0, -1));
              setError(null);
            }}
          >
            {t("debug.undo")}
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                setCopied(true);
              } catch {
                setError(t("debug.copyFailed"));
              }
            }}
          >
            {t(copied ? "debug.copied" : "debug.copyLink")}
          </button>
        </div>
        <details className="debug-section" open>
          <summary>
            {t("debug.scenarios")} <span>{matching.length}</span>
          </summary>
          <input
            type="search"
            aria-label={t("debug.search")}
            placeholder={t("debug.search")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <nav className="debug-scenarios" aria-label={t("debug.scenarios")}>
            {groups.map((group) => {
              const scenes = matching.filter((s) => s.group === group);
              return (
                scenes.length > 0 && (
                  <div key={group}>
                    <h2>{t(`debug.groups.${group}`)}</h2>
                    {scenes.map((s) => (
                      <button
                        key={s.id}
                        aria-current={s.id === scenarioId ? "true" : undefined}
                        onClick={() =>
                          onSelect(
                            s.id,
                            "minPlayers" in s
                              ? Math.max(playerCount, s.minPlayers)
                              : playerCount,
                          )
                        }
                      >
                        <span>{t(`debug.scenes.${s.id}.title`)}</span>
                        <span aria-hidden="true">
                          {s.id === scenarioId ? "●" : "↗"}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              );
            })}
            {!matching.length && <p>{t("debug.noResults")}</p>}
          </nav>
        </details>
        <section className="debug-section">
          <h2>{t("debug.advance")}</h2>
          {quickActions}
        </section>
        <details className="debug-section">
          <summary>{t("debug.connection")}</summary>
          <label className="debug-check">
            <input
              type="checkbox"
              checked={connected}
              onChange={(e) => setConnected(e.target.checked)}
            />
            {t("debug.connected")}
          </label>
          <label>
            {t("debug.latency")}
            <select
              value={latency}
              onChange={(e) => setLatency(Number(e.target.value))}
            >
              {[42, 250, 1200].map((ms) => (
                <option key={ms} value={ms}>
                  {ms} ms
                </option>
              ))}
            </select>
          </label>
          <p>{t("debug.latencyHint")}</p>
          <label className="debug-check">
            <input
              type="checkbox"
              checked={failNext}
              onChange={(e) => setFailNext(e.target.checked)}
            />
            {t("debug.failNext")}
          </label>
          <label>
            {t("debug.offlineSeat")}
            <select
              value=""
              onChange={(e) =>
                run((s) =>
                  applyEvent(s, {
                    type: "SET_CONNECTED",
                    by: e.target.value,
                    connected: !s.players.find((p) => p.id === e.target.value)!
                      .connected,
                  }),
                )
              }
            >
              <option value="" disabled>
                {t("debug.chooseSeat")}
              </option>
              {state.players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.seat + 1}. {p.name} ·{" "}
                  {t(p.connected ? "seat.online" : "seat.offline")}
                </option>
              ))}
            </select>
          </label>
        </details>
        <details className="debug-section">
          <summary>{t("debug.inspect")}</summary>
          <pre>{JSON.stringify(game, null, 2)}</pre>
        </details>
        {error && (
          <p className="debug-error" role="alert">
            {error}
          </p>
        )}
      </aside>
      <section className="debug-preview" aria-label={t("debug.preview")}>
        <header className="debug-caption">
          <div>
            <strong>{t(`debug.scenes.${scenarioId}.title`)}</strong>
            <p>{t(`debug.scenes.${scenarioId}.description`)}</p>
          </div>
          <span>{t(`phase.${state.phase}`)}</span>
        </header>
        <div className="debug-table">
          <GameView
            key={`${revision}-${viewerId}`}
            code="DEBUG"
            game={game}
            myPlayerId={viewerId === "spectator" ? null : viewerId}
            isHost
            conn={connected ? "connected" : "disconnected"}
            selfLatency={latency}
            actions={actions}
            onRestart={async () => {
              onSelect("role", playerCount);
              return { ok: true };
            }}
            functionsContent={
              <div className="debug-local-functions">
                <p>{t("debug.localOnly")}</p>
                {quickActions}
              </div>
            }
            seatClaimContent={
              <div className="debug-actions">
                {openSeat && (
                  <button
                    onClick={() => {
                      const id = openSeat;
                      commit({
                        ...stateRef.current,
                        roleAcks: stateRef.current.roleAcks.filter(
                          (p) => p !== id,
                        ),
                      });
                      setOpenSeat(undefined);
                      changeViewer(id);
                    }}
                  >
                    {t("debug.claimSeat", {
                      seat:
                        state.players.find((p) => p.id === openSeat)!.seat + 1,
                    })}
                  </button>
                )}
              </div>
            }
          />
        </div>
      </section>
    </div>
  );
}
