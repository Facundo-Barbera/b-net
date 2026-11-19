import { EmptyState, StatusDot } from "../../components/index.ts";
import type { BoardState } from "../../data/useSnapshot.ts";

/**
 * Inline notice when the board can't be read: not configured on this hub (503) says how to turn it on;
 * any other failure says it does not answer. Null when the board is fine.
 */
export function BoardGap({ board, testId = "board-gap" }: { board: BoardState; testId?: string }) {
  if (board.data && !board.error) return null;
  if (!board.missing && !board.error) return null;
  return (
    <EmptyState
      compact
      className="wk-gap"
      data-testid={testId}
      data-source-state={board.missing ? "missing" : "failing"}
      icon={<StatusDot tone={board.missing ? "dormant" : "danger"} label={board.missing ? "sin conectar" : "no responde"} />}
      title={board.missing ? "Tablero sin conectar: aquí verías tareas, avances y avisos de los bots." : `El tablero no responde (${board.error}).`}
    >
      {board.missing && (
        <p className="ui-empty__how">
          <span className="ui-label">Qué falta</span> HUB_BOARD_URL y HUB_BOARD_CONFIG_FILE en el hub (necesita HUB_DATA_DIR).
        </p>
      )}
    </EmptyState>
  );
}
