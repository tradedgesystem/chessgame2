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
      <div class="ca-section ca-inline ca-toggle-row">
        <label class="ca-toggle-label"><input type="checkbox" class="ca-auto-suggest" checked /> Show suggestions on board</label>
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
  const autoSuggestToggle = root.querySelector('.ca-auto-suggest');

  const isChessComHost = /\.chess\.com$/i.test(location.hostname.replace(/^www\./, ''));

  let boardElement = null;
  let boardOverlay = null;
  let boardObserver = null;
  let fenObserver = null;
  let resizeObserver = null;
  let lastImportedFen = null;
  let lastAnalyzedFen = null;
  let lastSuggestion = null;
  let autoSuggestEnabled = true;
  let autoSuggestTimer = null;

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

  function isBoardFlipped(el) {
    const orientation = (el.getAttribute('orientation') || el.getAttribute('data-orientation') || '').toLowerCase();
    if (orientation === 'black') return true;
    if (orientation === 'white') return false;
    const className = el.className || '';
    return /flipped|black/.test(className);
  }

  function ensureOverlay() {
    if (!boardElement) return;
    if (!boardOverlay) {
      boardOverlay = document.createElement('canvas');
      boardOverlay.className = 'ca-board-overlay';
      const currentPosition = getComputedStyle(boardElement).position;
      if (!currentPosition || currentPosition === 'static') {
        boardElement.style.position = 'relative';
      }
      boardElement.appendChild(boardOverlay);
      resizeObserver = new ResizeObserver(resizeOverlay);
      resizeObserver.observe(boardElement);
    }
    resizeOverlay();
  }

  function resizeOverlay() {
    if (!boardOverlay || !boardElement) return;
    const rect = boardElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    boardOverlay.width = rect.width * dpr;
    boardOverlay.height = rect.height * dpr;
    boardOverlay.style.width = `${rect.width}px`;
    boardOverlay.style.height = `${rect.height}px`;
    const ctx = boardOverlay.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, boardOverlay.width, boardOverlay.height);
  }

  function clearOverlay() {
    if (!boardOverlay) return;
    const ctx = boardOverlay.getContext('2d');
    ctx.clearRect(0, 0, boardOverlay.width, boardOverlay.height);
  }

  function squareCenter(square) {
    if (!boardElement || !boardOverlay) return null;
    const rect = boardElement.getBoundingClientRect();
    const cell = rect.width / 8;
    let file = square.charCodeAt(0) - 97;
    let rank = parseInt(square[1], 10) - 1;
    const flipped = isBoardFlipped(boardElement);
    if (!flipped) {
      rank = 7 - rank;
    } else {
      file = 7 - file;
    }
    return {
      x: file * cell + cell / 2,
      y: rank * cell + cell / 2,
      size: cell
    };
  }

  function drawSuggestion(move) {
    if (!move || !boardElement || !boardOverlay || !autoSuggestEnabled) return;
    ensureOverlay();
    const ctx = boardOverlay.getContext('2d');
    clearOverlay();

    const from = squareCenter(move.from);
    const to = squareCenter(move.to);
    if (!from || !to) return;

    const cell = from.size;
    ctx.lineWidth = Math.max(4, cell * 0.1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = 'rgba(255, 214, 102, 0.35)';
    ctx.strokeStyle = 'rgba(255, 214, 102, 0.9)';

    ctx.beginPath();
    ctx.rect(from.x - cell / 2, from.y - cell / 2, cell, cell);
    ctx.rect(to.x - cell / 2, to.y - cell / 2, cell, cell);
    ctx.fill();

    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowHead = cell * 0.6;
    const endX = to.x - Math.cos(angle) * (cell * 0.3);
    const endY = to.y - Math.sin(angle) * (cell * 0.3);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - arrowHead * Math.cos(angle - Math.PI / 7), endY - arrowHead * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(endX - arrowHead * Math.cos(angle + Math.PI / 7), endY - arrowHead * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
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

  function readFenFromBoard(el) {
    if (!el) return null;
    const attrs = ['data-live-fen', 'data-fen', 'fen', 'data-initialfen', 'data-startfen'];
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (value) return value.trim();
    }
    return null;
  }

  function loadFenIntoState(fen, { announce = true, message = 'Imported position from chess.com board.' } = {}) {
    if (!fen || fen === lastImportedFen) return false;
    if (!chess.load(fen)) return false;
    lastImportedFen = chess.fen();
    chess.history = [];
    chess.stateStack = [];
    fenArea.value = lastImportedFen;
    if (announce) {
      appendLog(message);
      setStatus('Position imported.', 'success');
    }
    queueAutoSuggest();
    return true;
  }

  function attachFenObserver() {
    if (!boardElement) return;
    if (fenObserver) fenObserver.disconnect();
    fenObserver = new MutationObserver(() => {
      const fen = readFenFromBoard(boardElement);
      if (fen) {
        const updated = loadFenIntoState(fen, { announce: false });
        if (updated) {
          appendLog('Live board updated. Synced position.');
        }
      }
    });
    fenObserver.observe(boardElement, {
      attributes: true,
      attributeFilter: ['data-live-fen', 'data-fen', 'fen', 'data-initialfen', 'data-startfen']
    });
  }

  function locateChessComBoard() {
    const candidates = Array.from(
      document.querySelectorAll('chess-board, [data-board-id], [data-live-fen], [data-fen]')
    );
    for (const el of candidates) {
      const fen = readFenFromBoard(el);
      if (fen) return el;
    }
    return null;
  }

  function detachBoard() {
    if (fenObserver) fenObserver.disconnect();
    fenObserver = null;
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    if (boardOverlay && boardOverlay.parentElement) {
      boardOverlay.parentElement.removeChild(boardOverlay);
    }
    boardOverlay = null;
    boardElement = null;
  }

  function handleBoardCandidate(el) {
    if (!el || el === boardElement) return;
    detachBoard();
    boardElement = el;
    ensureOverlay();
    attachFenObserver();
    const fen = readFenFromBoard(boardElement);
    if (fen) {
      loadFenIntoState(fen);
    }
  }

  function watchForBoard() {
    if (!isChessComHost) return;
    const existing = locateChessComBoard();
    if (existing) handleBoardCandidate(existing);

    if (boardObserver) boardObserver.disconnect();
    boardObserver = new MutationObserver(() => {
      const found = locateChessComBoard();
      if (found) handleBoardCandidate(found);
    });
    boardObserver.observe(document.body, { childList: true, subtree: true });
  }

  function importChessComPosition() {
    if (!/\.chess\.com$/.test(location.hostname) && !/\.chess\.com$/.test(location.hostname.replace(/^www\./, ''))) {
      setStatus('Import is only available on chess.com pages.', 'error');
      return;
    }

    const candidates = collectFenCandidates();
    for (const fen of candidates) {
      if (loadFenIntoState(fen, { message: 'Imported position from chess.com page.' })) return;
    }

    setStatus('Could not detect a board position on this page.', 'error');
  }

  function queueAutoSuggest() {
    if (!autoSuggestEnabled) {
      clearOverlay();
      return;
    }
    if (autoSuggestTimer) cancelAnimationFrame(autoSuggestTimer);
    autoSuggestTimer = requestAnimationFrame(runAutoSuggest);
  }

  function runAutoSuggest() {
    autoSuggestTimer = null;
    const fen = chess.fen();
    if (fen === lastAnalyzedFen) {
      if (lastSuggestion) drawSuggestion(lastSuggestion);
      return;
    }
    lastAnalyzedFen = fen;
    const depth = parseInt(depthInput.value, 10) || 2;
    const result = AssistantEngine.bestMove(chess, depth);
    lastSuggestion = result.move;
    if (result.move) {
      setStatus(`Auto-suggest: ${AssistantEngine.moveToDisplay(result.move)} (score ${result.score.toFixed(0)})`, 'success');
      drawSuggestion(result.move);
    } else {
      clearOverlay();
      setStatus('No legal moves available for auto-suggest.', 'error');
    }
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
    queueAutoSuggest();
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
      queueAutoSuggest();
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
    queueAutoSuggest();
  }

  function resetBoard() {
    chess.reset();
    chess.history = [];
    chess.stateStack = [];
    logEl.innerHTML = '';
    updateFen();
    setStatus('Board reset to starting position.', 'success');
    queueAutoSuggest();
  }

  function suggestMove() {
    const depth = parseInt(depthInput.value, 10) || 2;
    setStatus('Thinking...', 'info');
    requestAnimationFrame(() => {
      const result = AssistantEngine.bestMove(chess, depth);
      if (!result.move) {
        setStatus('No legal moves available.', 'error');
        return;
      }
      const moveText = AssistantEngine.moveToDisplay(result.move);
      const linePreview = result.line.slice(1).map((m) => AssistantEngine.moveToDisplay(m)).join(' → ');
      setStatus(`Suggested: ${moveText} (score ${result.score.toFixed(0)})${linePreview ? ' | Line: ' + linePreview : ''}`, 'success');
      lastSuggestion = result.move;
      drawSuggestion(result.move);
    });
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
    queueAutoSuggest();
  });

  autoSuggestToggle.addEventListener('change', () => {
    autoSuggestEnabled = autoSuggestToggle.checked;
    if (!autoSuggestEnabled) {
      clearOverlay();
    } else {
      queueAutoSuggest();
    }
  });

  watchForBoard();
  updateFen();
})();
