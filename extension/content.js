(function() {
  if (window.__chessAssistantLoaded) return;
  window.__chessAssistantLoaded = true;

  const chess = new Chess();

  const root = document.createElement('div');
  root.className = 'chess-assistant-root';
  root.innerHTML = `
    <button class="ca-toggle" aria-label="Open chess assistant">♟</button>
    <div class="ca-panel hidden">
      <div class="ca-header">
        <div class="ca-title">Chess Assistant</div>
        <div class="ca-subtitle">Offline helper • No API credits</div>
        <button class="ca-close" aria-label="Close">×</button>
      </div>
      <div class="ca-section">
        <label>Position (FEN)</label>
        <textarea class="ca-fen"></textarea>
        <div class="ca-buttons">
          <button class="ca-load">Load FEN</button>
          <button class="ca-reset">Reset</button>
          <button class="ca-import" title="Import the current chess.com board if detected">Import chess.com</button>
        </div>
      </div>
      <div class="ca-section">
        <label>Apply move (coordinate, e.g. e2e4 or e7e8q)</label>
        <div class="ca-inline">
          <input type="text" class="ca-move-input" placeholder="e2e4" />
          <button class="ca-apply">Apply</button>
          <button class="ca-undo">Undo</button>
        </div>
        <div class="ca-note">Moves are validated locally; no network requests are made.</div>
      </div>
      <div class="ca-section">
        <label>Engine depth <span class="ca-depth-value">2</span></label>
        <input type="range" min="1" max="4" value="2" class="ca-depth" />
        <button class="ca-suggest">Suggest move</button>
        <div class="ca-status"></div>
      </div>
      <div class="ca-section">
        <label>Move log</label>
        <div class="ca-log"></div>
      </div>
      <div class="ca-section ca-help">
        <div>• Paste any FEN or press Reset for the starting position.</div>
        <div>• Use coordinate notation (e.g., b1c3, e7e8q for promotions).</div>
        <div>• Suggestions run entirely in-browser with a lightweight search.</div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const toggleBtn = root.querySelector('.ca-toggle');
  const panel = root.querySelector('.ca-panel');
  const closeBtn = root.querySelector('.ca-close');
  const fenArea = root.querySelector('.ca-fen');
  const loadBtn = root.querySelector('.ca-load');
  const resetBtn = root.querySelector('.ca-reset');
  const importBtn = root.querySelector('.ca-import');
  const moveInput = root.querySelector('.ca-move-input');
  const applyBtn = root.querySelector('.ca-apply');
  const undoBtn = root.querySelector('.ca-undo');
  const logEl = root.querySelector('.ca-log');
  const statusEl = root.querySelector('.ca-status');
  const suggestBtn = root.querySelector('.ca-suggest');
  const depthInput = root.querySelector('.ca-depth');
  const depthValue = root.querySelector('.ca-depth-value');

  let analysisWorker = null;
  let lastAnalyzedFen = '';
  let boardObserver = null;
  let workerRequestId = 0;
  let fallbackTimer = null;

  const STOCKFISH_DEPTH = 10;
  const STOCKFISH_MOVETIME = 1200;

  function ensureWorker() {
    if (analysisWorker) return analysisWorker;
    const workerUrl = chrome.runtime.getURL('stockfish-worker.js');
    analysisWorker = new Worker(workerUrl);
    analysisWorker.onmessage = handleWorkerMessage;
    analysisWorker.onerror = () => {
      setStatus('Stockfish worker failed; falling back to built-in search.', 'error');
    };
    return analysisWorker;
  }

  function handleWorkerMessage(event) {
    const data = event.data || {};
    if (data.type !== 'analysis') return;

    if (fallbackTimer && data.requestId === workerRequestId) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    if (data.error) {
      setStatus(data.error, 'error');
      return;
    }

    if (!data.move) {
      setStatus('No legal moves found for this position.', 'error');
      return;
    }

    const linePreview = (data.line || []).slice(0, 5).join(' → ');
    const moveText = data.move;
    const sourceLabel = data.source === 'stockfish' ? 'Stockfish' : 'Built-in';
    const scoreText = typeof data.score === 'number' ? `score ${data.score}` : 'score N/A';
    setStatus(`${sourceLabel}: ${moveText} (${scoreText})${linePreview ? ' | Line: ' + linePreview : ''}`, 'success');
  }

  function postFenToWorker(fen, depth = STOCKFISH_DEPTH) {
    ensureWorker();
    workerRequestId += 1;
    analysisWorker.postMessage({ type: 'analyze', fen, depth, movetime: STOCKFISH_MOVETIME, requestId: workerRequestId });
  }

  function startChessComWatcher() {
    if (boardObserver || (!/\.chess\.com$/.test(location.hostname) && !/\.chess\.com$/.test(location.hostname.replace(/^www\./, '')))) {
      return;
    }

    const refreshAnalysis = () => {
      const candidates = collectFenCandidates();
      for (const fen of candidates) {
        if (fen === lastAnalyzedFen) return;
        const valid = chess.load(fen);
        if (valid) {
          lastAnalyzedFen = fen;
          fenArea.value = fen;
          postFenToWorker(fen);
          setStatus('Board updated from chess.com; analyzing...', 'info');
          return;
        }
      }
    };

    boardObserver = new MutationObserver(() => refreshAnalysis());
    boardObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
    refreshAnalysis();
  }

  function updateFen() {
    fenArea.value = chess.fen();
  }

  function appendLog(text) {
    const entry = document.createElement('div');
    entry.textContent = text;
    logEl.prepend(entry);
  }

  function setStatus(text, type = 'info') {
    statusEl.textContent = text;
    statusEl.dataset.state = type;
  }

  function collectFenCandidates() {
    const attrs = ['data-fen', 'fen', 'data-initialfen', 'data-puzzle-fen', 'data-startfen', 'data-live-fen'];
    const selectors = ['[data-fen]', '[fen]', '[data-initialfen]', '[data-puzzle-fen]', '[data-startfen]', '[data-live-fen]', 'chess-board', 'cg-board'];
    const candidates = new Set();

    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        attrs.forEach((attr) => {
          const value = el.getAttribute(attr);
          if (value) candidates.add(value.trim());
        });
        if (el.tagName && el.tagName.toLowerCase() === 'chess-board') {
          const boardFen = el.getAttribute('fen') || el.getAttribute('data-fen');
          if (boardFen) candidates.add(boardFen.trim());
        }
      });
    });

    // chess.com puzzle/game pages sometimes expose fen in embedded JSON
    document.querySelectorAll('script[type="application/json"]').forEach((script) => {
      const text = script.textContent || '';
      const matches = text.match(/"fen"\s*:\s*"([^"]+)"/g) || [];
      matches.forEach((m) => {
        const fen = m.split(':')[1].replace(/^[\s\"]+|[\s\"]+$/g, '');
        if (fen) candidates.add(fen);
      });
    });

    return Array.from(candidates);
  }

  function importChessComPosition() {
    if (!/\.chess\.com$/.test(location.hostname) && !/\.chess\.com$/.test(location.hostname.replace(/^www\./, ''))) {
      setStatus('Import is only available on chess.com pages.', 'error');
      return;
    }

    const candidates = collectFenCandidates();
    for (const fen of candidates) {
      if (chess.load(fen)) {
        chess.history = [];
        chess.stateStack = [];
        fenArea.value = chess.fen();
        appendLog('Imported position from chess.com page.');
        setStatus('Position imported.', 'success');
        return;
      }
    }

    setStatus('Could not detect a board position on this page.', 'error');
  }

  function applyMove(moveText) {
    const move = chess.move(moveText);
    if (!move) {
      setStatus('Illegal move. Try coordinate format like e2e4.', 'error');
      return;
    }
    appendLog(`${chess.turn === 'w' ? 'Black' : 'White'} played ${AssistantEngine.moveToDisplay(move)}`);
    updateFen();
    setStatus('Move applied.', 'success');
    if (chess.gameOver()) {
      if (chess.inCheckmate()) {
        setStatus('Checkmate! Position is final.', 'success');
      } else if (chess.inStalemate()) {
        setStatus('Stalemate reached.', 'info');
      }
    }
  }

  function undoMove() {
    const undone = chess.undo();
    if (undone) {
      appendLog(`Undo ${AssistantEngine.moveToDisplay(undone)}`);
      updateFen();
      setStatus('Undid last move.', 'info');
    } else {
      setStatus('No moves to undo.', 'error');
    }
  }

  function loadPosition() {
    const fen = fenArea.value.trim();
    if (!fen) return;
    const loaded = chess.load(fen);
    if (!loaded) {
      setStatus('Invalid FEN string.', 'error');
      return;
    }
    chess.history = [];
    chess.stateStack = [];
    appendLog('Position loaded from FEN.');
    updateFen();
    setStatus('Position updated.', 'success');
  }

  function resetBoard() {
    chess.reset();
    chess.history = [];
    chess.stateStack = [];
    logEl.innerHTML = '';
    updateFen();
    setStatus('Board reset to starting position.', 'success');
  }

  function suggestMove() {
    const depth = parseInt(depthInput.value, 10) || 2;
    setStatus('Thinking...', 'info');
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    try {
      postFenToWorker(chess.fen(), Math.min(20, Math.max(depth * 2, STOCKFISH_DEPTH)));
      fallbackTimer = setTimeout(() => {
        const result = AssistantEngine.bestMove(chess, depth);
        if (!result.move) {
          setStatus('No legal moves available.', 'error');
          return;
        }
        const moveText = AssistantEngine.moveToDisplay(result.move);
        const linePreview = result.line.slice(1).map((m) => AssistantEngine.moveToDisplay(m)).join(' → ');
        setStatus(`Suggested: ${moveText} (score ${result.score.toFixed(0)})${linePreview ? ' | Line: ' + linePreview : ''}`, 'success');
      }, 1500);
    } catch (err) {
      const result = AssistantEngine.bestMove(chess, depth);
      if (!result.move) {
        setStatus('No legal moves available.', 'error');
        return;
      }
      const moveText = AssistantEngine.moveToDisplay(result.move);
      const linePreview = result.line.slice(1).map((m) => AssistantEngine.moveToDisplay(m)).join(' → ');
      setStatus(`Suggested: ${moveText} (score ${result.score.toFixed(0)})${linePreview ? ' | Line: ' + linePreview : ''}`, 'success');
    }
  }

  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      updateFen();
    }
  });

  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  loadBtn.addEventListener('click', loadPosition);
  resetBtn.addEventListener('click', resetBoard);
  importBtn.addEventListener('click', importChessComPosition);
  applyBtn.addEventListener('click', () => applyMove(moveInput.value));
  moveInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyMove(moveInput.value);
  });
  undoBtn.addEventListener('click', undoMove);
  suggestBtn.addEventListener('click', suggestMove);
  depthInput.addEventListener('input', () => {
    depthValue.textContent = depthInput.value;
  });

  startChessComWatcher();
  updateFen();
})();
