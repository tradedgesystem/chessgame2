/*
 * Lightweight Stockfish-compatible stub.
 * This is designed to run inside a Web Worker and accepts a subset of UCI commands.
 * It uses the bundled AssistantEngine for calculation so we can ship a JS-only build
 * in offline environments. The public API mirrors the standard Stockfish() factory
 * used by the wasm builds (onmessage + postMessage).
 */
(function(global) {
  function Stockfish() {
    let onmessage = null;
    let currentFen = null;
    let searchDepth = 10;

    function emit(text) {
      if (typeof onmessage === 'function') onmessage(text);
    }

    function parsePosition(command) {
      const parts = command.split(/\s+/);
      const fenIndex = parts.indexOf('fen');
      if (fenIndex === -1) return;
      currentFen = parts.slice(fenIndex + 1).join(' ');
    }

    function bestLineFromResult(result) {
      const toUci = (move) => `${move.from}${move.to}${move.promotion || ''}`;
      return result.line.map(toUci);
    }

    function runSearch() {
      const chess = new Chess();
      if (!currentFen || !chess.load(currentFen)) {
        emit('bestmove (none)');
        return;
      }
      const result = AssistantEngine.bestMove(chess, searchDepth);
      const moveText = result.move ? `${result.move.from}${result.move.to}${result.move.promotion || ''}` : '(none)';
      const line = bestLineFromResult(result);
      emit(`info depth ${searchDepth} score cp ${Math.round(result.score)} pv ${line.join(' ')}`);
      emit(`bestmove ${moveText}`);
    }

    return {
      get onmessage() {
        return onmessage;
      },
      set onmessage(handler) {
        onmessage = handler;
      },
      postMessage(command) {
        if (!command || typeof command !== 'string') return;
        if (command === 'uci') {
          emit('id name Stockfish JS Stub');
          emit('id author OpenAI Sandbox');
          emit('uciok');
          return;
        }
        if (command === 'isready') {
          emit('readyok');
          return;
        }
        if (command.startsWith('setoption')) {
          const depthMatch = command.match(/name\s+Depth\s+value\s+(\d+)/i);
          if (depthMatch) {
            searchDepth = Math.max(1, parseInt(depthMatch[1], 10));
          }
          return;
        }
        if (command.startsWith('ucinewgame')) {
          currentFen = null;
          return;
        }
        if (command.startsWith('position')) {
          parsePosition(command);
          return;
        }
        if (command.startsWith('go')) {
          const depthMatch = command.match(/depth\s+(\d+)/);
          if (depthMatch) searchDepth = Math.max(1, parseInt(depthMatch[1], 10));
          setTimeout(runSearch, 0);
          return;
        }
      }
    };
  }

  global.Stockfish = Stockfish;
})(typeof self !== 'undefined' ? self : this);
