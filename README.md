# chessgame2

A free, offline-friendly Chrome extension that adds a floating chess assistant to any page. It includes a bundled rules engine and lightweight search so you never need API credits or network calls.

## Features
- On-page assistant toggle with FEN editor and coordinate move entry.
- Local rules engine for validating moves, undoing, and detecting endgame states.
- Built-in minimax search (configurable depth) for quick move suggestions.
- No external dependencies or paid APIs.

### Stockfish worker
- A bundled Stockfish-compatible worker runs analysis off the main thread using the shipped JS/WASM build under `extension/lib/`.
- On chess.com pages, the extension automatically streams the current board FEN into the worker after each move and shows the best line/score.
- For responsive play, keep Stockfish depth near **10** with **~1.2s** (1200 ms) movetime; higher values can stall live games.

## Install (developer mode)
1. Open **chrome://extensions** in Chrome and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder in this repository.
3. Visit any site (including chess.com) and click the assistant pawn button in the lower-right corner to expand the panel.

## Using the assistant
- Paste or tweak a position in the FEN box, then press **Load FEN** (or **Reset** to start from the initial position). On chess.com, use **Import chess.com** to pull the current board FEN automatically.
- Enter moves in coordinate notation (e.g., `e2e4`, `b1c3`, `e7e8q` for promotions) and hit **Apply**.
- Press **Suggest move** to run the built-in search; adjust the depth slider for more/less calculation.
- **Undo** removes the last move, and the move log tracks recent actions.

All analysis runs locally in your browser; the extension does not call external services.
