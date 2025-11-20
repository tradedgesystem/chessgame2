(function(global) {
  function algebraic(index) {
    const files = 'abcdefgh';
    return files[index % 8] + (8 - Math.floor(index / 8));
  }

  const PIECE_VALUE = {
    p: 100,
    n: 320,
    b: 330,
    r: 500,
    q: 900,
    k: 20000
  };

  function evaluateBoard(chess) {
    let score = 0;
    for (let i = 0; i < 64; i++) {
      const piece = chess.board[i];
      if (!piece) continue;
      const value = PIECE_VALUE[piece.type] || 0;
      score += piece.color === 'w' ? value : -value;
    }
    // Encourage mobility slightly
    const turn = chess.turn;
    const currentMoves = chess.moves({ verbose: true }).length;
    chess.turn = turn === 'w' ? 'b' : 'w';
    const opponentMoves = chess.moves({ verbose: true }).length;
    chess.turn = turn;
    score += (currentMoves - opponentMoves) * 2;
    return score;
  }

  function bestMove(chess, depth = 2) {
    const rootColor = chess.turn;
    const result = minimax(chess, depth, -Infinity, Infinity, rootColor);
    return result;
  }

  function minimax(chess, depth, alpha, beta, rootColor) {
    if (depth === 0 || chess.gameOver()) {
      return { score: scoreFromRoot(chess, rootColor), line: [] };
    }

    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) {
      return { score: scoreFromRoot(chess, rootColor), line: [] };
    }

    const maximizing = chess.turn === rootColor;
    let bestScore = maximizing ? -Infinity : Infinity;
    let bestLine = [];
    let bestMove = null;

    for (const move of moves) {
      chess.makeMove(move, false);
      const next = minimax(chess, depth - 1, alpha, beta, rootColor);
      chess.undo();

      if (maximizing) {
        if (next.score > bestScore) {
          bestScore = next.score;
          bestMove = move;
          bestLine = [move, ...next.line];
        }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (next.score < bestScore) {
          bestScore = next.score;
          bestMove = move;
          bestLine = [move, ...next.line];
        }
        beta = Math.min(beta, bestScore);
      }
      if (beta <= alpha) break;
    }

    return { move: bestMove, score: bestScore, line: bestLine };
  }

  function scoreFromRoot(chess, rootColor) {
    const material = evaluateBoard(chess);
    return rootColor === 'w' ? material : -material;
  }

  function moveToDisplay(move) {
    if (!move) return 'No move found';
    const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : '';
    const capture = move.captured ? 'x' : '-';
    return `${algebraic(move.from)}${capture}${algebraic(move.to)}${promotion}`;
  }

  global.AssistantEngine = {
    bestMove,
    moveToDisplay
  };
})(typeof window !== 'undefined' ? window : global);
