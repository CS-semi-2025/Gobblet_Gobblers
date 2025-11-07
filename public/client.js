// client.js - Browser client using Socket.IO
const socket = io();

// UI references
const boardEl = document.getElementById('board');
const handContainer = document.getElementById('handContainer');
const logEl = document.getElementById('log');
const meLabel = document.getElementById('meLabel');
const turnLabel = document.getElementById('turnLabel');
const gameStateLabel = document.getElementById('gameStateLabel');

const joinBtn = document.getElementById('joinBtn');
const nameInput = document.getElementById('nameInput');
const restartBtn = document.getElementById('restartBtn');
const leaveBtn = document.getElementById('leaveBtn');

let mySlot = null; // 'A'|'B'|'spectator'
let myId = null;
let state = null;
let selectedPiece = null; // { from:{type:'hand'|'cell', r,c?}, size? }

// initialization: create 3x3 cells
function buildBoard() {
  boardEl.innerHTML = '';
  for (let r=0;r<3;r++){
    for (let c=0;c<3;c++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.addEventListener('click', onCellClick);
      boardEl.appendChild(cell);
    }
  }
}
buildBoard();

function addLog(s){
  const t = new Date().toLocaleTimeString();
  logEl.innerHTML = `<div>[${t}] ${escapeHtml(s)}</div>` + logEl.innerHTML;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function render(stateObj){
  state = stateObj;
  // update labels
  turnLabel.textContent = state.currentTurn || '—';
  gameStateLabel.textContent = state.winner ? `終了: ${state.winner}` : (state.started ? '進行中' : '待機中');
  meLabel.textContent = mySlot ? `${mySlot}` : '未割当';

  // render board stacks
  for (let r=0;r<3;r++){
    for (let c=0;c<3;c++){
      const idx = r*3 + c;
      const cell = boardEl.children[idx];
      cell.innerHTML = '';
      const stack = (state.board && state.board[r] && state.board[r][c]) ? state.board[r][c] : [];
      const stackWrap = document.createElement('div');
      stackWrap.className = 'stack';
      // draw from bottom to top
      for (let i=0;i<stack.length;i++){
        const p = stack[i];
        const el = document.createElement('div');
        el.className = `piece size-${p.size} color-${p.owner === 'A' ? 'A' : 'B'}`;
        el.textContent = ''; // could show initial
        if (i === stack.length-1) el.dataset.top = 'true';
        stackWrap.appendChild(el);
      }
      cell.appendChild(stackWrap);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = stack.length ? `${stack.at(-1).owner} / ${stack.length}` : '';
      cell.appendChild(meta);
    }
  }

  // render hand (for my slot)
  renderHand();
}

function renderHand(){
  handContainer.innerHTML = '';
  if (!state || !mySlot || !state.players) return;
  const me = state.players[mySlot];
  if (!me) return;
  const sizes = ['large','medium','small'];
  sizes.forEach(size=>{
    const num = me.pieces[size] || 0;
    for (let i=0;i<num;i++){
      const wrapper = document.createElement('div');
      wrapper.className = 'hand-piece';
      const piece = document.createElement('div');
      piece.className = `piece size-${size} color-${mySlot==='A'?'A':'B'}`;
      piece.textContent = size[0].toUpperCase();
      wrapper.appendChild(piece);
      wrapper.dataset.size = size;
      wrapper.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectedPiece = { from: { type: 'hand'}, size };
        highlightSelection();
        addLog(`手駒選択: ${size}`);
      });
      handContainer.appendChild(wrapper);
    }
  });
}

function clearSelection(){
  selectedPiece = null;
  document.querySelectorAll('.selected').forEach(el=>el.classList.remove('selected'));
}
function highlightSelection(){
  document.querySelectorAll('.cell').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.hand-piece').forEach(el=>el.classList.remove('selected'));
  if (!selectedPiece) return;
  if (selectedPiece.from.type === 'hand'){
    const el = [...handContainer.children].find(ch => ch.dataset.size === selectedPiece.size);
    if (el) el.classList.add('selected');
  } else if (selectedPiece.from.type === 'cell'){
    const idx = selectedPiece.from.r * 3 + selectedPiece.from.c;
    const cell = boardEl.children[idx];
    if (cell) cell.classList.add('selected');
  }
}

// cell click handler
function onCellClick(e){
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);

  // if nothing selected: try to select top visible piece if belongs to me (for move)
  if (!selectedPiece){
    const stack = state.board[r][c];
    if (stack && stack.length){
      const top = stack.at(-1);
      if (top.owner === mySlot) {
        selectedPiece = { from: { type:'cell', r, c }, size: top.size };
        highlightSelection();
        addLog(`盤上駒選択: (${r},${c})`);
        return;
      } else {
        addLog('そのマスの見えている駒はあなたのものではありません');
        return;
      }
    } else {
      addLog('先に手駒を選択してください');
      return;
    }
  }

  // if selected from hand -> place_from_hand
  if (selectedPiece.from.type === 'hand') {
    const payload = { action:'place_from_hand', size:selectedPiece.size, to:{ r,c } };
    socket.emit('place_piece', payload, (ack) => {
      if (ack && ack.error) addLog('エラー: ' + ack.error);
    });
    addLog(`手駒を送信: ${selectedPiece.size} -> (${r},${c})`);
    clearSelection();
    return;
  }

  // if selected from cell -> move_on_board
  if (selectedPiece.from.type === 'cell') {
    const payload = { action:'move_on_board', from:{ r:selectedPiece.from.r, c:selectedPiece.from.c }, to:{ r,c } };
    socket.emit('place_piece', payload, (ack) => {
      if (ack && ack.error) addLog('エラー: ' + ack.error);
    });
    addLog(`盤上駒の移動を送信: (${selectedPiece.from.r},${selectedPiece.from.c}) -> (${r},${c})`);
    clearSelection();
    return;
  }
}

joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Guest';
  socket.emit('join', { name }, (ack) => {
    if (ack && ack.slot) {
      mySlot = ack.slot;
      addLog(`join 成功: ${mySlot}`);
      if (mySlot === 'spectator') addLog('観戦モードです');
    } else {
      addLog('join 応答なし');
    }
  });
});

restartBtn.addEventListener('click', () => {
  socket.emit('restart_game', {}, (ack) => {
    if (ack && ack.ok) addLog('再戦リクエスト送信');
    else if (ack && ack.error) addLog('再戦失敗: ' + ack.error);
  });
});

leaveBtn.addEventListener('click', () => {
  socket.disconnect();
  addLog('切断しました');
});

// socket events
socket.on('connect', () => {
  myId = socket.id;
  addLog('サーバー接続: ' + myId);
});
socket.on('init', (s) => {
  addLog('初期状態受信');
  render(s);
});
socket.on('assign', (d) => {
  if (d && d.slot) {
    mySlot = d.slot;
    addLog('あなたの割当: ' + mySlot);
  }
});
socket.on('start_game', (s) => {
  addLog('ゲーム開始');
  render(s);
});
socket.on('update_state', (s) => {
  addLog('状態更新受信');
  render(s);
});
socket.on('invalid_move', (d) => {
  addLog('不正手: ' + (d && d.reason ? d.reason : 'unknown'));
});
socket.on('game_over', (d) => {
  addLog('ゲーム終了: 勝者 = ' + d.winner);
  render(d.state);
});
socket.on('disconnect', () => {
  addLog('サーバー切断');
});
