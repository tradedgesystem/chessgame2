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
        <label class="ca-auto-row">
          <input type="checkbox" class="ca-auto-toggle" />
          Auto-suggest on move
        </label>
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
  const autoToggle = root.querySelector('.ca-auto-toggle');

  let autoSuggestEnabled = false;
  let trackedBoard = null;
  let boardObserver = null;
  let boardResizeObserver = null;
  let lastBoardFen = null;
  let boardChangeFrame = null;

  const overlayManager = {
    boardEl: null,
    svg: null,
    resizeObserver: null,
    updateBounds: () => {
      if (!overlayManager.boardEl || !overlayManager.svg) return;
      const rect = overlayManager.boardEl.getBoundingClientRect();
      overlayManager.svg.style.width = `${rect.width}px`;
      overlayManager.svg.style.height = `${rect.height}px`;
      overlayManager.svg.style.left = `${rect.left + window.scrollX}px`;
      overlayManager.svg.style.top = `${rect.top + window.scrollY}px`;
      overlayManager.svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    },
    ensure(boardEl) {
      if (boardEl) overlayManager.boardEl = boardEl;
      if (!overlayManager.boardEl) return null;

      if (!overlayManager.svg) {
        overlayManager.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlayManager.svg.classList.add('ca-board-overlay');
        overlayManager.svg.setAttribute('aria-hidden', 'true');
        overlayManager.svg.style.position = 'absolute';
        overlayManager.svg.style.pointerEvents = 'none';
        overlayManager.svg.style.zIndex = '2147483646';
        document.body.appendChild(overlayManager.svg);
        window.addEventListener('scroll', overlayManager.updateBounds, true);
        window.addEventListener('resize', overlayManager.updateBounds);
      }

      if (overlayManager.resizeObserver) overlayManager.resizeObserver.disconnect();
      overlayManager.resizeObserver = new ResizeObserver(() => overlayManager.updateBounds());
      overlayManager.resizeObserver.observe(overlayManager.boardEl);
      overlayManager.updateBounds();
      return overlayManager.svg;
    },
    clear() {
      if (overlayManager.svg) overlayManager.svg.innerHTML = '';
    },
    teardown() {
      if (overlayManager.resizeObserver) overlayManager.resizeObserver.disconnect();
      overlayManager.resizeObserver = null;
      if (overlayManager.svg && overlayManager.svg.parentElement) overlayManager.svg.parentElement.removeChild(overlayManager.svg);
      overlayManager.svg = null;
      overlayManager.boardEl = null;
    }
  };

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

  function findBoardElement() {
    const selectors = ['chess-board', 'cg-board', '.board', '.board-b72b1', '[data-boardid]', '[data-board-type]'];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate) return candidate;
    }
    return null;
  }

  function readFenFromBoard(boardEl) {
    const attrs = ['data-fen', 'fen', 'data-initialfen', 'data-puzzle-fen', 'data-startfen', 'data-live-fen'];
    for (const attr of attrs) {
      const fen = boardEl.getAttribute(attr);
      if (fen) return fen.trim();
    }
    return null;
  }

  function detectBoardOrientation(boardEl) {
    const attr = (boardEl.getAttribute('data-orientation') || boardEl.getAttribute('orientation') || '').toLowerCase();
    if (attr === 'black' || attr === 'b') return 'black';
    const cls = boardEl.className || '';
    if (/flipped|orientation-black|black-bottom/.test(cls)) return 'black';
    return 'white';
  }

  function squareToPoint(square, rect, orientation) {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    const width = rect.width || 1;
    const height = rect.height || 1;
    const squareWidth = width / 8;
    const squareHeight = height / 8;
    const xIndex = orientation === 'white' ? file : 7 - file;
    const yIndex = orientation === 'white' ? 7 - rank : rank;
    return {
      x: (xIndex + 0.5) * squareWidth,
      y: (yIndex + 0.5) * squareHeight,
      squareWidth,
      squareHeight
    };
  }

  function renderMoveOverlay(move) {
    if (!trackedBoard || !move) return;
    const svg = overlayManager.ensure(trackedBoard);
    if (!svg) return;
    overlayManager.clear();

    const rect = trackedBoard.getBoundingClientRect();
    const orientation = detectBoardOrientation(trackedBoard);
    const fromPoint = squareToPoint(move.from, rect, orientation);
    const toPoint = squareToPoint(move.to, rect, orientation);
    const label = `Suggested move: ${AssistantEngine.moveToDisplay(move)}`;
    svg.removeAttribute('aria-hidden');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);

    const ns = 'http://www.w3.org/2000/svg';
    const title = document.createElementNS(ns, 'title');
    title.textContent = label;
    svg.appendChild(title);

    const defs = document.createElementNS(ns, 'defs');
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', 'ca-arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '5');
    marker.setAttribute('orient', 'auto');
    const arrowPath = document.createElementNS(ns, 'path');
    arrowPath.setAttribute('d', 'M0,0 L10,5 L0,10 z');
    arrowPath.setAttribute('fill', '#5da9ff');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const highlights = [
      { point: fromPoint, color: 'rgba(255, 212, 121, 0.4)' },
      { point: toPoint, color: 'rgba(93, 169, 255, 0.35)' }
    ];

    highlights.forEach(({ point, color }) => {
      const rectEl = document.createElementNS(ns, 'rect');
      rectEl.setAttribute('x', point.x - point.squareWidth / 2);
      rectEl.setAttribute('y', point.y - point.squareHeight / 2);
      rectEl.setAttribute('width', point.squareWidth);
      rectEl.setAttribute('height', point.squareHeight);
      rectEl.setAttribute('rx', Math.min(point.squareWidth, point.squareHeight) * 0.15);
      rectEl.setAttribute('fill', color);
      svg.appendChild(rectEl);
    });

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', fromPoint.x);
    line.setAttribute('y1', fromPoint.y);
    line.setAttribute('x2', toPoint.x);
    line.setAttribute('y2', toPoint.y);
    line.setAttribute('stroke', '#5da9ff');
    line.setAttribute('stroke-width', Math.max(6, Math.min(fromPoint.squareWidth, fromPoint.squareHeight) * 0.18));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#ca-arrowhead)');
    svg.appendChild(line);
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

  function queueBoardCheck() {
    if (boardChangeFrame) return;
    boardChangeFrame = requestAnimationFrame(() => {
      boardChangeFrame = null;
      handleBoardChange();
    });
  }

  function handleBoardChange() {
    if (!trackedBoard) return;
    overlayManager.updateBounds();

    const fenFromBoard = readFenFromBoard(trackedBoard);
    const fen = fenFromBoard || collectFenCandidates()[0];
    if (!fen || fen === lastBoardFen) return;

    const loaded = chess.load(fen);
    if (!loaded) return;

    chess.history = [];
    chess.stateStack = [];
    lastBoardFen = fen;
    updateFen();
    overlayManager.clear();
    setStatus('Detected board update; position synced.', 'info');
    if (autoSuggestEnabled) {
      suggestMove();
    }
  }

  function startBoardTracking() {
    const boardEl = findBoardElement();
    if (!boardEl) return false;

    trackedBoard = boardEl;
    overlayManager.ensure(trackedBoard);

    if (boardObserver) boardObserver.disconnect();
    boardObserver = new MutationObserver(queueBoardCheck);
    boardObserver.observe(trackedBoard, {
      attributes: true,
      attributeFilter: ['data-fen', 'fen', 'class', 'style'],
      childList: true,
      subtree: true
    });

    if (boardResizeObserver) boardResizeObserver.disconnect();
    boardResizeObserver = new ResizeObserver(() => overlayManager.updateBounds());
    boardResizeObserver.observe(trackedBoard);
    queueBoardCheck();
    return true;
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
        const tracking = startBoardTracking();
        if (!tracking) {
          setStatus('Position imported, but a visible board was not found for overlays.', 'info');
        }
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
    lastBoardFen = chess.fen();
    overlayManager.clear();
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
      lastBoardFen = chess.fen();
      overlayManager.clear();
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
    lastBoardFen = chess.fen();
    overlayManager.clear();
    setStatus('Position updated.', 'success');
  }

  function resetBoard() {
    chess.reset();
    chess.history = [];
    chess.stateStack = [];
    logEl.innerHTML = '';
    updateFen();
    lastBoardFen = chess.fen();
    overlayManager.clear();
    setStatus('Board reset to starting position.', 'success');
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
      if (!trackedBoard) {
        startBoardTracking();
      }
      renderMoveOverlay(result.move);
      setStatus(`Suggested: ${moveText} (score ${result.score.toFixed(0)})${linePreview ? ' | Line: ' + linePreview : ''}`, 'success');
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
  });
  autoToggle.addEventListener('change', () => {
    autoSuggestEnabled = autoToggle.checked;
    if (autoSuggestEnabled) {
      const tracking = startBoardTracking();
      if (!tracking) {
        setStatus('Auto-suggest enabled, but no on-page board was detected yet.', 'info');
      } else {
        setStatus('Auto-suggest enabled. Watching for board updates.', 'info');
        queueBoardCheck();
      }
    } else {
      setStatus('Auto-suggest disabled.', 'info');
    }
  });

  updateFen();
})();
