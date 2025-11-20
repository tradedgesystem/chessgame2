importScripts(chrome.runtime.getURL('lib/chess.js'));
importScripts(chrome.runtime.getURL('engine.js'));
importScripts(chrome.runtime.getURL('lib/stockfish.js'));

const DEFAULT_DEPTH = 10;
const DEFAULT_MOVETIME = 1200;
let engineInstance = typeof Stockfish === 'function' ? Stockfish() : null;
let pendingAnalysis = null;

function moveToUci(move) {
  if (!move) return '';
  return `${move.from}${move.to}${move.promotion ? move.promotion : ''}`;
}

function parseStockfishMessage(text) {
  if (!pendingAnalysis) return;

  if (typeof text !== 'string') return;

  if (text.includes('readyok')) {
    pendingAnalysis.ready = true;
    return;
  }

  if (text.startsWith('info')) {
    const scoreMatch = text.match(/score\s+(cp|mate)\s+(-?\d+)/);
    const pvMatch = text.match(/pv\s+(.+)$/);
    if (scoreMatch) {
      const [, type, value] = scoreMatch;
      const numericScore = type === 'mate' ? (value > 0 ? 9999 : -9999) : parseInt(value, 10);
      pendingAnalysis.score = numericScore;
    }
    if (pvMatch) {
      pendingAnalysis.line = pvMatch[1].trim().split(/\s+/);
    }
    return;
  }

  if (text.startsWith('bestmove')) {
    const parts = text.split(/\s+/);
    const best = parts[1];
    postMessage({
      type: 'analysis',
      source: 'stockfish',
      move: best,
      line: pendingAnalysis.line || [],
      score: pendingAnalysis.score,
      depth: pendingAnalysis.depth,
      fen: pendingAnalysis.fen,
      requestId: pendingAnalysis.requestId
    });
    pendingAnalysis = null;
  }
}

function runStockfish(fen, depth, movetime, requestId) {
  if (!engineInstance) return false;

  pendingAnalysis = { fen, depth, ready: false, line: [], score: null, requestId };
  engineInstance.onmessage = parseStockfishMessage;
  engineInstance.postMessage('ucinewgame');
  engineInstance.postMessage(`position fen ${fen}`);
  engineInstance.postMessage(`go depth ${depth} movetime ${movetime}`);
  return true;
}

function runFallbackSearch(fen, depth, requestId) {
  const chess = new Chess();
  if (!chess.load(fen)) {
    postMessage({ type: 'analysis', source: 'fallback', error: 'Invalid FEN', requestId });
    return;
  }
  const result = AssistantEngine.bestMove(chess, Math.max(1, depth || 3));
  postMessage({
    type: 'analysis',
    source: 'fallback',
    move: moveToUci(result.move),
    score: result.score,
    line: result.line.map(moveToUci),
    depth: depth,
    fen,
    requestId
  });
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type !== 'analyze' || !data.fen) return;

  const depth = data.depth || DEFAULT_DEPTH;
  const movetime = data.movetime || DEFAULT_MOVETIME;

  const kickedOff = runStockfish(data.fen, depth, movetime, data.requestId);
  if (!kickedOff) {
    runFallbackSearch(data.fen, depth, data.requestId);
  }
};
