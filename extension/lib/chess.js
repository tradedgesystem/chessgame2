// Lightweight chess logic inspired by chess.js (MIT licensed).
// Provides enough functionality for local move validation and engine search without any external APIs.

(function(global) {
  const WHITE = 'w';
  const BLACK = 'b';

  const PIECE_TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];

  const FLAGS = {
    NORMAL: 'n',
    CAPTURE: 'c',
    PAWN_DOUBLE: 'b',
    KING_SIDE_CASTLE: 'k',
    QUEEN_SIDE_CASTLE: 'q',
    EN_PASSANT: 'e',
    PROMOTION: 'p'
  };

  const SYMBOLS = {
    p: 'p',
    n: 'n',
    b: 'b',
    r: 'r',
    q: 'q',
    k: 'k'
  };

  const DEFAULT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const OFFSETS = {
    n: [-17, -15, -10, -6, 6, 10, 15, 17],
    b: [-9, -7, 7, 9],
    r: [-8, -1, 1, 8],
    q: [-9, -7, 7, 9, -8, -1, 1, 8],
    k: [-9, -8, -7, -1, 1, 7, 8, 9]
  };

  function rank(index) {
    return Math.floor(index / 8);
  }

  function file(index) {
    return index % 8;
  }

  function algebraic(index) {
    const files = 'abcdefgh';
    return files[file(index)] + (8 - rank(index));
  }

  function squareIndex(square) {
    const files = 'abcdefgh';
    const f = files.indexOf(square[0]);
    const r = parseInt(square[1], 10);
    if (f < 0 || r < 1 || r > 8) return null;
    return (8 - r) * 8 + f;
  }

  function deepcopyBoard(board) {
    return board.map((piece) => (piece ? { ...piece } : null));
  }

  class Chess {
    constructor(fen = DEFAULT_FEN) {
      this.load(fen);
    }

    reset() {
      this.load(DEFAULT_FEN);
    }

    load(fen) {
      const tokens = fen.trim().split(/\s+/);
      if (tokens.length < 4) return false;

      const [position, turn, castling, enPassant, half, full] = tokens;
      const rows = position.split('/');
      if (rows.length !== 8) return false;

      this.board = new Array(64).fill(null);
      for (let r = 0; r < 8; r++) {
        let filePointer = 0;
        for (const char of rows[r]) {
          if (/[1-8]/.test(char)) {
            filePointer += parseInt(char, 10);
          } else {
            const color = char === char.toUpperCase() ? WHITE : BLACK;
            const type = char.toLowerCase();
            if (!PIECE_TYPES.includes(type)) return false;
            const idx = r * 8 + filePointer;
            this.board[idx] = { type, color };
            filePointer += 1;
          }
        }
        if (filePointer !== 8) return false;
      }

      this.turn = turn === BLACK ? BLACK : WHITE;
      this.castling = {
        w: { k: castling.includes('K'), q: castling.includes('Q') },
        b: { k: castling.includes('k'), q: castling.includes('q') }
      };
      this.epSquare = enPassant === '-' ? null : squareIndex(enPassant);
      this.halfmoveClock = half ? parseInt(half, 10) : 0;
      this.fullmoveNumber = full ? parseInt(full, 10) : 1;
      this.history = [];
      this.stateStack = [];
      return true;
    }

    fen() {
      let fen = '';
      for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const piece = this.board[r * 8 + f];
          if (!piece) {
            empty += 1;
          } else {
            if (empty > 0) {
              fen += empty;
              empty = 0;
            }
            fen += piece.color === WHITE ? piece.type.toUpperCase() : piece.type;
          }
        }
        if (empty > 0) fen += empty;
        if (r !== 7) fen += '/';
      }

      const castling = `${this.castling.w.k ? 'K' : ''}${this.castling.w.q ? 'Q' : ''}${this.castling.b.k ? 'k' : ''}${this.castling.b.q ? 'q' : ''}` || '-';
      const ep = this.epSquare !== null ? algebraic(this.epSquare) : '-';
      return `${fen} ${this.turn} ${castling} ${ep} ${this.halfmoveClock} ${this.fullmoveNumber}`;
    }

    piece(square) {
      const idx = typeof square === 'number' ? square : squareIndex(square);
      return this.board[idx] ? { ...this.board[idx] } : null;
    }

    inBounds(index) {
      return index >= 0 && index < 64;
    }

    generatePseudoMoves() {
      const moves = [];
      for (let i = 0; i < 64; i++) {
        const piece = this.board[i];
        if (!piece || piece.color !== this.turn) continue;
        switch (piece.type) {
          case 'p':
            this.generatePawnMoves(i, piece, moves);
            break;
          case 'n':
            this.generateStepMoves(i, piece, OFFSETS.n, moves, false);
            break;
          case 'b':
            this.generateStepMoves(i, piece, OFFSETS.b, moves, true);
            break;
          case 'r':
            this.generateStepMoves(i, piece, OFFSETS.r, moves, true);
            break;
          case 'q':
            this.generateStepMoves(i, piece, OFFSETS.q, moves, true);
            break;
          case 'k':
            this.generateKingMoves(i, piece, moves);
            break;
          default:
            break;
        }
      }
      return moves;
    }

    generatePawnMoves(from, piece, moves) {
      const dir = piece.color === WHITE ? -8 : 8;
      const startRank = piece.color === WHITE ? 6 : 1;
      const promotionRank = piece.color === WHITE ? 0 : 7;
      const fromRank = rank(from);

      const oneStep = from + dir;
      if (this.inBounds(oneStep) && !this.board[oneStep]) {
        if (rank(oneStep) === promotionRank) {
          ['q', 'r', 'b', 'n'].forEach((promo) => {
            moves.push(this.buildMove(from, oneStep, piece, null, FLAGS.PROMOTION, promo));
          });
        } else {
          moves.push(this.buildMove(from, oneStep, piece, null, FLAGS.NORMAL));
        }

        if (fromRank === startRank) {
          const twoStep = from + dir * 2;
          if (!this.board[twoStep]) {
            moves.push(this.buildMove(from, twoStep, piece, null, FLAGS.PAWN_DOUBLE));
          }
        }
      }

      [-1, 1].forEach((offset) => {
        const target = oneStep + offset;
        if (!this.inBounds(target)) return;
        if (Math.abs(file(from) - file(target)) !== 1) return;
        const captured = this.board[target];
        if (captured && captured.color !== piece.color) {
          if (rank(target) === promotionRank) {
            ['q', 'r', 'b', 'n'].forEach((promo) => {
              moves.push(this.buildMove(from, target, piece, captured, [FLAGS.PROMOTION, FLAGS.CAPTURE], promo));
            });
          } else {
            moves.push(this.buildMove(from, target, piece, captured, FLAGS.CAPTURE));
          }
        }
        if (this.epSquare !== null && target === this.epSquare) {
          const capturedIndex = piece.color === WHITE ? target + 8 : target - 8;
          const capturedPawn = this.board[capturedIndex];
          moves.push(this.buildMove(from, target, piece, capturedPawn, FLAGS.EN_PASSANT));
        }
      });
    }

    generateStepMoves(from, piece, offsets, moves, slide) {
      offsets.forEach((offset) => {
        let target = from + offset;
        while (this.inBounds(target)) {
          const wrapLimit = slide ? 1 : 2;
          if (Math.abs(file(target) - file(target - offset)) > wrapLimit) break;
          const occupying = this.board[target];
          if (!occupying) {
            moves.push(this.buildMove(from, target, piece, null, FLAGS.NORMAL));
          } else {
            if (occupying.color !== piece.color) {
              moves.push(this.buildMove(from, target, piece, occupying, FLAGS.CAPTURE));
            }
            break;
          }
          if (!slide) break;
          target += offset;
        }
      });
    }

    generateKingMoves(from, piece, moves) {
      OFFSETS.k.forEach((offset) => {
        const target = from + offset;
        if (!this.inBounds(target)) return;
        if (Math.abs(file(target) - file(from)) > 1 || Math.abs(rank(target) - rank(from)) > 1) return;
        const occupying = this.board[target];
        if (!occupying) {
          moves.push(this.buildMove(from, target, piece, null, FLAGS.NORMAL));
        } else if (occupying.color !== piece.color) {
          moves.push(this.buildMove(from, target, piece, occupying, FLAGS.CAPTURE));
        }
      });
      // Castling
      if (piece.color === WHITE) {
        if (this.castling.w.k && !this.board[61] && !this.board[62] && !this.isSquareAttacked(BLACK, from) && !this.isSquareAttacked(BLACK, 61) && !this.isSquareAttacked(BLACK, 62)) {
          moves.push(this.buildMove(from, 62, piece, null, FLAGS.KING_SIDE_CASTLE));
        }
        if (this.castling.w.q && !this.board[59] && !this.board[58] && !this.board[57] && !this.isSquareAttacked(BLACK, from) && !this.isSquareAttacked(BLACK, 59) && !this.isSquareAttacked(BLACK, 58)) {
          moves.push(this.buildMove(from, 58, piece, null, FLAGS.QUEEN_SIDE_CASTLE));
        }
      } else {
        if (this.castling.b.k && !this.board[5] && !this.board[6] && !this.isSquareAttacked(WHITE, from) && !this.isSquareAttacked(WHITE, 5) && !this.isSquareAttacked(WHITE, 6)) {
          moves.push(this.buildMove(from, 6, piece, null, FLAGS.KING_SIDE_CASTLE));
        }
        if (this.castling.b.q && !this.board[1] && !this.board[2] && !this.board[3] && !this.isSquareAttacked(WHITE, from) && !this.isSquareAttacked(WHITE, 2) && !this.isSquareAttacked(WHITE, 3)) {
          moves.push(this.buildMove(from, 2, piece, null, FLAGS.QUEEN_SIDE_CASTLE));
        }
      }
    }

    buildMove(from, to, piece, captured, flag, promotion) {
      return {
        color: piece.color,
        from,
        to,
        piece: piece.type,
        captured: captured ? captured.type : undefined,
        flags: typeof flag === 'string' ? flag : flag.join(''),
        promotion
      };
    }

    moves(options = {}) {
      const legalMoves = [];
      const pseudoMoves = this.generatePseudoMoves();
      for (const move of pseudoMoves) {
        this.makeMove(move);
        const inCheck = this.isKingInCheck(this.toggle(this.turn));
        this.undo();
        if (!inCheck) {
          legalMoves.push(options.verbose ? move : this.moveToString(move));
        }
      }
      return legalMoves;
    }

    move(moveInput) {
      const moveObj = this.sanitizeMove(moveInput);
      if (!moveObj) return null;
      const legalMoves = this.moves({ verbose: true });
      const chosen = legalMoves.find((m) => m.from === moveObj.from && m.to === moveObj.to && (!m.promotion || m.promotion === moveObj.promotion));
      if (!chosen) return null;
      this.makeMove(chosen, true);
      return chosen;
    }

    undo() {
      if (!this.stateStack || this.stateStack.length === 0) return null;
      const state = this.stateStack.pop();
      this.board = state.board;
      this.turn = state.turn;
      this.castling = state.castling;
      this.epSquare = state.epSquare;
      this.halfmoveClock = state.halfmoveClock;
      this.fullmoveNumber = state.fullmoveNumber;
      if (state.historySaved) this.history.pop();
      return state.lastMove;
    }

    sanitizeMove(moveInput) {
      if (typeof moveInput === 'string') {
        const cleaned = moveInput.trim();
        const from = cleaned.slice(0, 2);
        const to = cleaned.slice(2, 4);
        const promotion = cleaned.length >= 5 ? cleaned[4].toLowerCase() : undefined;
        const fromIndex = squareIndex(from);
        const toIndex = squareIndex(to);
        if (fromIndex === null || toIndex === null) return null;
        return { from: fromIndex, to: toIndex, promotion };
      }
      if (typeof moveInput === 'object' && moveInput.from && moveInput.to) {
        const fromIndex = squareIndex(moveInput.from);
        const toIndex = squareIndex(moveInput.to);
        if (fromIndex === null || toIndex === null) return null;
        return { from: fromIndex, to: toIndex, promotion: moveInput.promotion };
      }
      return null;
    }

    makeMove(move, saveToHistory = false) {
      if (!this.stateStack) this.stateStack = [];
      this.stateStack.push({
        board: deepcopyBoard(this.board),
        turn: this.turn,
        castling: {
          w: { ...this.castling.w },
          b: { ...this.castling.b }
        },
        epSquare: this.epSquare,
        halfmoveClock: this.halfmoveClock,
        fullmoveNumber: this.fullmoveNumber,
        lastMove: move,
        historySaved: saveToHistory
      });
      if (saveToHistory) {
        this.history.push(move);
      }

      const fromPiece = this.board[move.from];
      this.board[move.from] = null;
      let capturedPiece = null;

      if (move.flags === FLAGS.EN_PASSANT) {
        const captureIndex = move.color === WHITE ? move.to + 8 : move.to - 8;
        capturedPiece = this.board[captureIndex];
        this.board[captureIndex] = null;
      } else {
        capturedPiece = this.board[move.to];
      }

      const movingPiece = { ...fromPiece };
      if (move.promotion) {
        movingPiece.type = move.promotion;
      }
      this.board[move.to] = movingPiece;

      // Castling moves the rook too
      if (move.flags === FLAGS.KING_SIDE_CASTLE) {
        if (move.color === WHITE) {
          this.board[63] = null;
          this.board[61] = { type: 'r', color: WHITE };
        } else {
          this.board[7] = null;
          this.board[5] = { type: 'r', color: BLACK };
        }
      }
      if (move.flags === FLAGS.QUEEN_SIDE_CASTLE) {
        if (move.color === WHITE) {
          this.board[56] = null;
          this.board[59] = { type: 'r', color: WHITE };
        } else {
          this.board[0] = null;
          this.board[3] = { type: 'r', color: BLACK };
        }
      }

      // Update castling rights when king or rook moves or when rook is captured
      if (fromPiece.type === 'k') {
        this.castling[fromPiece.color].k = false;
        this.castling[fromPiece.color].q = false;
      }
      if (fromPiece.type === 'r') {
        if (fromPiece.color === WHITE) {
          if (move.from === 63) this.castling.w.k = false;
          if (move.from === 56) this.castling.w.q = false;
        } else {
          if (move.from === 7) this.castling.b.k = false;
          if (move.from === 0) this.castling.b.q = false;
        }
      }
      if (capturedPiece && capturedPiece.type === 'r') {
        if (move.to === 63) this.castling.w.k = false;
        if (move.to === 56) this.castling.w.q = false;
        if (move.to === 7) this.castling.b.k = false;
        if (move.to === 0) this.castling.b.q = false;
      }

      // En-passant target square
      if (move.flags === FLAGS.PAWN_DOUBLE) {
        this.epSquare = move.color === WHITE ? move.to + 8 : move.to - 8;
      } else {
        this.epSquare = null;
      }

      // Halfmove clock
      if (fromPiece.type === 'p' || capturedPiece) {
        this.halfmoveClock = 0;
      } else {
        this.halfmoveClock += 1;
      }

      if (this.turn === BLACK) this.fullmoveNumber += 1;

      this.turn = this.toggle(this.turn);
    }

    toggle(color) {
      return color === WHITE ? BLACK : WHITE;
    }

    isKingInCheck(color) {
      const kingSquare = this.board.findIndex((p) => p && p.type === 'k' && p.color === color);
      if (kingSquare === -1) return false;
      return this.isSquareAttacked(this.toggle(color), kingSquare);
    }

    isSquareAttacked(attackerColor, square) {
      // Pawns
      const pawnDir = attackerColor === WHITE ? -8 : 8;
      const pawnOffsets = [pawnDir - 1, pawnDir + 1];
      for (const off of pawnOffsets) {
        const target = square + off;
        if (!this.inBounds(target)) continue;
        if (Math.abs(file(square) - file(target)) !== 1) continue;
        const piece = this.board[target];
        if (piece && piece.color === attackerColor && piece.type === 'p') return true;
      }

      // Knights
      for (const off of OFFSETS.n) {
        const target = square + off;
        if (!this.inBounds(target)) continue;
        if (Math.abs(file(square) - file(target)) > 2) continue;
        const piece = this.board[target];
        if (piece && piece.color === attackerColor && piece.type === 'n') return true;
      }

      // Sliding pieces
      const slideChecks = [
        { offsets: OFFSETS.b, pieces: ['b', 'q'] },
        { offsets: OFFSETS.r, pieces: ['r', 'q'] }
      ];
      for (const { offsets, pieces } of slideChecks) {
        for (const off of offsets) {
          let target = square + off;
          while (this.inBounds(target)) {
            if (Math.abs(file(target) - file(target - off)) > 1) break;
            const piece = this.board[target];
            if (piece) {
              if (piece.color === attackerColor && pieces.includes(piece.type)) return true;
              break;
            }
            target += off;
          }
        }
      }

      // King
      for (const off of OFFSETS.k) {
        const target = square + off;
        if (!this.inBounds(target)) continue;
        if (Math.abs(file(square) - file(target)) > 1) continue;
        const piece = this.board[target];
        if (piece && piece.color === attackerColor && piece.type === 'k') return true;
      }

      return false;
    }

    moveToString(move) {
      const promotion = move.promotion ? move.promotion : '';
      return `${algebraic(move.from)}${algebraic(move.to)}${promotion}`;
    }

    inCheck() {
      return this.isKingInCheck(this.turn);
    }

    inCheckmate() {
      return this.inCheck() && this.moves({}).length === 0;
    }

    inStalemate() {
      return !this.inCheck() && this.moves({}).length === 0;
    }

    gameOver() {
      return this.inCheckmate() || this.inStalemate();
    }
  }

  Chess.DEFAULT_FEN = DEFAULT_FEN;
  Chess.FLAGS = FLAGS;

  global.Chess = Chess;
})(typeof window !== 'undefined' ? window : global);
