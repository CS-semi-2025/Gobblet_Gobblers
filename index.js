// server.js
// Node.js + Express + Socket.IO based server for Gobblet Gobblers
// Usage: node server.js

import express from "express";
import http from "http";
import { Server as IOServer } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new IOServer(server);

// serve static client files from /public
app.use(express.static("public"));

// ----------------- game state -----------------
function makeEmptyBoard() {
  return [
    [[], [], []],
    [[], [], []],
    [[], [], []]
  ];
}

let gameState = {
  board: makeEmptyBoard(),
  players: {
    // slot keys 'A' and 'B' reserved; each slot may be null (no player)
    A: null,
    B: null
  },
  currentTurn: null, // 'A' or 'B'
  winner: null,
  started: false
};

// helper: map size name to numeric value
const SIZE_VAL = { small: 1, medium: 2, large: 3 };

// reset game
function resetGame() {  //やり直し
  gameState.board = makeEmptyBoard();
  if (gameState.players.A) gameState.players.A.pieces = { small: 2, medium: 2, large: 2 };
  if (gameState.players.B) gameState.players.B.pieces = { small: 2, medium: 2, large: 2 };
  gameState.currentTurn = gameState.players.A ? "A" : null;
  gameState.winner = null;
  gameState.started = !!(gameState.players.A && gameState.players.B);
}

// ----------------- rules -----------------
function canPlaceAt(toR, toC, pieceSizeName, playerKey) {
  const targetStack = gameState.board[toR][toC];
  const topPiece = targetStack.at(-1);
  const pieceVal = SIZE_VAL[pieceSizeName];
  if (!topPiece) return true;
  // can cover only if piece is bigger than top
  if (pieceVal > SIZE_VAL[topPiece.size]) return true;
  return false;
}

function checkWinner() {
  const lines = [
    // rows
    [[0,0],[0,1],[0,2]],
    [[1,0],[1,1],[1,2]],
    [[2,0],[2,1],[2,2]],
    // cols
    [[0,0],[1,0],[2,0]],
    [[0,1],[1,1],[2,1]],
    [[0,2],[1,2],[2,2]],
    // diags
    [[0,0],[1,1],[2,2]],
    [[0,2],[1,1],[2,0]]
    //これは全パターンちぇっく
  ];

  for (const line of lines) {
    const topOwners = line.map(([r,c]) => {
      const stack = gameState.board[r][c];
      return stack.length ? stack.at(-1).owner : null; // owner 'A'|'B'
    });
    if (topOwners.every(o => o && o === topOwners[0])) {
      return topOwners[0]; // 'A' or 'B'
    }
  }
  return null;
}

// ----------------- socket handling -----------------
/*
Protocol (client <-> server):
- client -> server:
  - 'join' : { name }
  - 'place_piece' : payload where payload.action in ['place_from_hand','move_on_board']
      place_from_hand: { action:'place_from_hand', size:'small'|'medium'|'large', to:{r,c} }
      move_on_board: { action:'move_on_board', from:{r,c}, to:{r,c} }
  - 'restart_game' : {}
- server -> client:
  - 'init' : { state } (on connect)
  - 'start_game' : { state }
  - 'update_state' : { state }
  - 'invalid_move' : { reason }
  - 'game_over' : { winner, state }
  - 'assign' : { slot } // 'A' or 'B' or 'spectator'
*/

function broadcastState() {
  io.emit("update_state", sanitizeStateForClients());
}

function sanitizeStateForClients() {
  // create a deep-light copy safe for clients (no socket references)
  const players = {};
  for (const k of ['A','B']) {
    const p = gameState.players[k];
    if (p) {
      players[k] = {
        slot: k,
        name: p.name,
        color: p.color,
        pieces: { ...p.pieces },
        id: p.id
      };
    } else players[k] = null;
  }
  return {
    board: gameState.board,
    players,
    currentTurn: gameState.currentTurn,
    winner: gameState.winner,
    started: gameState.started
  };
}

io.on("connection", (socket) => {
  console.log("client connected:", socket.id);
  // send initial snapshot
  socket.emit("init", sanitizeStateForClients());

  // when client asks to join as player
  socket.on("join", (data, ack) => {
    const name = (data && data.name) ? String(data.name).slice(0,50) : "Guest";
    // assign to A or B if free
    let assigned = null;
    if (!gameState.players.A) {
      gameState.players.A = {
        id: socket.id,
        name,
        color: "blue",
        pieces: { small:2, medium:2, large:2 }
      };
      assigned = "A";
    } else if (!gameState.players.B) {
      gameState.players.B = {
        id: socket.id,
        name,
        color: "orange",
        pieces: { small:2, medium:2, large:2 }
      };
      assigned = "B";
    } else {
      assigned = "spectator";
    }

    // persist mapping on socket
    socket.data.playerSlot = assigned;
    socket.data.playerName = name;

    // if both players present, start/reset game
    if (gameState.players.A && gameState.players.B) {
      gameState.currentTurn = "A";
      gameState.winner = null;
      gameState.started = true;
      // ensure pieces reset if new join
      if (!gameState.players.A.pieces) gameState.players.A.pieces = { small:2, medium:2, large:2 };
      if (!gameState.players.B.pieces) gameState.players.B.pieces = { small:2, medium:2, large:2 };
      gameState.board = makeEmptyBoard();
    } else {
      gameState.started = false;
    }

    // inform the joining socket
    socket.emit("assign", { slot: assigned });
    io.emit("update_state", sanitizeStateForClients());
    if (gameState.started) {
      io.emit("start_game", sanitizeStateForClients());
    }

    if (ack) ack({ ok: true, slot: assigned });
  });

  socket.on("place_piece", (payload, ack) => {
    // validate player
    const slot = socket.data.playerSlot;
    if (!slot || (slot !== "A" && slot !== "B")) {
      socket.emit("invalid_move", { reason: "プレイヤーではありません (spectator)" });
      if (ack) ack({ error: "not_player" });
      return;
    }
    if (!gameState.started) {
      socket.emit("invalid_move", { reason: "対戦相手が揃っていません" });
      if (ack) ack({ error: "not_started" });
      return;
    }
    if (gameState.winner) {
      socket.emit("invalid_move", { reason: "ゲームは終了しています" });
      if (ack) ack({ error: "game_over" });
      return;
    }
    if (gameState.currentTurn !== slot) {
      socket.emit("invalid_move", { reason: "現在のターンではありません" });
      if (ack) ack({ error: "not_your_turn" });
      return;
    }

    try {
      if (!payload || !payload.action) throw new Error("invalid payload");
      const player = gameState.players[slot];

      if (payload.action === "place_from_hand") {
        const size = payload.size;
        const to = payload.to;
        if (!["small","medium","large"].includes(size)) throw new Error("invalid size");
        if (!player.pieces || (player.pieces[size] <= 0)) {
          socket.emit("invalid_move", { reason: "そのサイズの手駒がありません" });
          if (ack) ack({ error: "no_piece" });
          return;
        }
        if (to == null || typeof to.r !== "number" || typeof to.c !== "number") {
          throw new Error("invalid target");
        }

        if (!canPlaceAt(to.r, to.c, size, slot)) {
          socket.emit("invalid_move", { reason: "そのマスには置けません (サイズ違反)" });
          if (ack) ack({ error: "illegal" });
          return;
        }

        // perform placement
        gameState.board[to.r][to.c].push({ owner: slot, size, color: player.color });
        player.pieces[size]--;
      }
      else if (payload.action === "move_on_board") {
        const from = payload.from;
        const to = payload.to;
        if (!from || !to) throw new Error("invalid from/to");
        const srcStack = gameState.board[from.r][from.c];
        if (!srcStack.length) {
          socket.emit("invalid_move", { reason: "移動元に駒がありません" });
          if (ack) ack({ error: "empty_from" });
          return;
        }
        const top = srcStack.at(-1);
        if (top.owner !== slot) {
          socket.emit("invalid_move", { reason: "移動できるのはあなたの見えている駒だけです" });
          if (ack) ack({ error: "not_your_piece" });
          return;
        }
        // check can place on destination
        if (!canPlaceAt(to.r, to.c, top.size, slot)) {
          socket.emit("invalid_move", { reason: "そのマスには移動できません (サイズ違反)" });
          if (ack) ack({ error: "illegal" });
          return;
        }
        // pop from src and push to dest
        srcStack.pop();
        gameState.board[to.r][to.c].push(top);
      }
      else {
        throw new Error("unknown action");
      }

      // after a successful move check win
      const winnerSlot = checkWinner();
      if (winnerSlot) {
        gameState.winner = winnerSlot;
        gameState.started = false;
        io.emit("game_over", { winner: winnerSlot, state: sanitizeStateForClients() });
        io.emit("update_state", sanitizeStateForClients());
        if (ack) ack({ ok: true, winner: winnerSlot });
        return;
      }

      // toggle turn
      gameState.currentTurn = (gameState.currentTurn === "A") ? "B" : "A";

      // broadcast updated state
      broadcastState();
      if (ack) ack({ ok: true });
    } catch (err) {
      console.error("place_piece error:", err);
      socket.emit("invalid_move", { reason: "サーバーエラー" });
      if (ack) ack({ error: "server_error" });
    }
  });

  socket.on("restart_game", (data, ack) => {
    // only players can request restart. If both players agree, reset.
    // For simplicity: if both players present, restart immediately.
    if (!gameState.players.A || !gameState.players.B) {
      if (ack) ack({ error: "need_two_players" });
      return;
    }
    resetGame();
    io.emit("start_game", sanitizeStateForClients());
    if (ack) ack({ ok: true });
  });

  socket.on("disconnect", () => {
    console.log("client disconnected:", socket.id);
    // if socket was a player, free their slot and notify
    const slot = socket.data.playerSlot;
    if (slot === "A" || slot === "B") {
      // keep spectators; free slot
      if (gameState.players[slot] && gameState.players[slot].id === socket.id) {
        gameState.players[slot] = null;
      }
      // end current game
      gameState.started = false;
      gameState.winner = null;
      gameState.currentTurn = null;
      io.emit("update_state", sanitizeStateForClients());
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
