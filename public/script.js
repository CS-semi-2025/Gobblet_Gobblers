// client.js (Three.js version)
// Three.js 本体をインポート
import * as THREE from 'three';
// (必要なら OrbitControls などもインポート)
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Socket.IO と 既存UI要素の参照 ---
const socket = io();

// UI参照 (ログ、ステータスパネル、ボタン類はDOMのまま)
const logEl = document.getElementById('log');
const meLabel = document.getElementById('meLabel');
const turnLabel = document.getElementById('turnLabel');
const gameStateLabel = document.getElementById('gameStateLabel');
const joinBtn = document.getElementById('joinBtn');
const nameInput = document.getElementById('nameInput');
const restartBtn = document.getElementById('restartBtn');
const leaveBtn = document.getElementById('leaveBtn');
const boardWrap = document.querySelector('.board-wrap'); // Canvasの親
const handContainer = document.getElementById('handContainer');

let mySlot = null;
let myId = null;
let state = null;
let selectedPiece = null; // { from:{type:'hand'|'cell', r,c?}, size? }

// --- Three.js セットアップ ---
let scene, camera, renderer, raycaster, pointer;
let boardGroup; // 3D盤面
let pieceMeshes = []; // 表示中の3D駒オブジェクトの配列
const cellObjects = []; // クリック判定用の透明なマス (3x3)
let selectedMesh = null; // 選択中の3Dメッシュ

// 色の定義 (CSSと合わせる)
const COLORS = {
    A: 0x1f78b4,
    B: 0xef6c00,
    board: 0xffffff,
    selected: 0xfacc15 // 黄色
};

// 駒の物理サイズ
const PIECE_SIZES = { 
    small: {r: 0.8, h: 1.0}, 
    medium: {r: 1.1, h: 1.5}, 
    large: {r: 1.4, h: 2.0} 
};
const CELL_GAP = 3.3; // 3D空間でのマス間の距離
const BOARD_OFFSET = -CELL_GAP; // (0,0)が中心になるようにオフセット

/**
 * 1. Three.js シーンの初期化
 */
function initThree() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f6fb); // CSSの背景色と合わせる

    // カメラ
    const aspect = boardWrap.clientWidth / 500; // 高さは500pxに固定
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    camera.position.set(0, 10, 12); // 斜め上からの視点
    camera.lookAt(0, 0, 0);

    // ライト
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true; // 影を有効化 (オプション)
    scene.add(directionalLight);

    // レンダラー
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(boardWrap.clientWidth, 500); // サイズ指定
    renderer.shadowMap.enabled = true; // 影を有効化 (オプション)
    boardWrap.innerHTML = ''; // 元の .board を削除
    boardWrap.appendChild(renderer.domElement); // Canvasを追加

    // レイキャスター (クリック判定用)
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    // イベントリスナー
    renderer.domElement.addEventListener('click', onCanvasClick); // 3Dクリック
    window.addEventListener('resize', onWindowResize);
}

/**
 * 2. 3D盤面の構築 (元の buildBoard の代わり)
 */
function buildBoard3D() {
    boardGroup = new THREE.Group();

    // 盤面 (3x3の板)
    const boardGeo = new THREE.BoxGeometry(CELL_GAP * 3, 0.2, CELL_GAP * 3);
    const boardMat = new THREE.MeshStandardMaterial({ color: COLORS.board });
    const boardMesh = new THREE.Mesh(boardGeo, boardMat);
    boardMesh.receiveShadow = true; // 影を受け取る
    boardGroup.add(boardMesh);

    // 3x3のクリック判定用マス (透明)
    const cellGeo = new THREE.BoxGeometry(3, 0.1, 3); // マスのサイズ
    cellGeo.translate(0, 0.15, 0); // 盤面よりわずかに上

    // ▼▼▼ 修正箇所 ▼▼▼
    // visible: false だとクリック判定されないため、透明度0で対応します
    const cellMat = new THREE.MeshBasicMaterial({ 
        color: 0xff0000, // 色は何でも良い（見えないので）
        transparent: true, 
        opacity: 0       // 透明にする
    });
    // ▲▲▲ 修正箇所 ▲▲▲

    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const cell = new THREE.Mesh(cellGeo, cellMat);
            // 3D空間上の座標
            cell.position.set(c * CELL_GAP + BOARD_OFFSET, 0, r * CELL_GAP + BOARD_OFFSET);
            // クリック時に(r,c)を特定するためのデータ
            cell.userData = { type: 'cell', r, c }; 
            boardGroup.add(cell);
            cellObjects.push(cell); // クリック判定対象に追加
        }
    }
    scene.add(boardGroup);
    
    // (TODO: 手駒置き場の3Dオブジェクトもここで作成・配置すると良い)
}

/**
 * (新規) 駒の3Dメッシュを作成するヘルパー関数
 */
function createPieceMesh(size, owner) {
    const { r, h } = PIECE_SIZES[size];

    // 形状 (円柱)
    const geometry = new THREE.CylinderGeometry(r, r, h, 32);
    // 色
    const color = COLORS[owner];
    const material = new THREE.MeshStandardMaterial({ color: color });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
}

/**
 * 3. 状態を描画 (元の render の完全書き換え)
 */
function render(stateObj) {
    state = stateObj;
    
    // ラベル類（DOM）の更新 (これはそのまま)
    turnLabel.textContent = state.currentTurn || '—';
    gameStateLabel.textContent = state.winner ? `終了: ${state.winner}` : (state.started ? '進行中' : '待機中');
    meLabel.textContent = mySlot ? `${mySlot}` : '未割当';

    // --- 3D描画処理 ---
    
    // 1. 既存の3D駒メッシュを全て削除
    pieceMeshes.forEach(mesh => scene.remove(mesh));
    pieceMeshes = [];

    // 2. サーバーからの盤面状態(state.board)に基づいて駒メッシュを再構築
    if (state.board) {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const stack = (state.board[r] && state.board[r][c]) ? state.board[r][c] : [];
                
                // 3D空間上の(r,c)に対応する座標
                const x = c * CELL_GAP + BOARD_OFFSET;
                const z = r * CELL_GAP + BOARD_OFFSET;

                // スタックを物理的に積み上げる
                let currentHeight = 0;
                for (let i = 0; i < stack.length; i++) {
                    const p = stack[i]; // { owner, size, color }
                    const pieceMesh = createPieceMesh(p.size, p.owner);
                    
                    const y = currentHeight + pieceMesh.geometry.parameters.height / 2 + 0.1;
                    pieceMesh.position.set(x, y, z);
                    
                    // クリック判定用のデータを仕込む
                    pieceMesh.userData = { 
                        type: 'piece', 
                        r, c, 
                        size: p.size, 
                        owner: p.owner, 
                        isTop: (i === stack.length - 1) 
                    };
                    
                    scene.add(pieceMesh);
                    pieceMeshes.push(pieceMesh); // 削除できるように保持
                    
                    currentHeight += pieceMesh.geometry.parameters.height * 0.2; // 少し重ねる
                }
            }
        }
    }
    
    // 3. 手駒の描画 (DOM)
    renderHandDOM();
    
    // 4. 3Dシーンのレンダリング
    renderer.render(scene, camera);
}

/**
 * 1. Three.js シーンの初期化
 */
function onCanvasClick(event) {
    // 画面座標(px)を-1から1の範囲（正規化デバイス座標）に変換
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // レイキャスターで交差判定
    raycaster.setFromCamera(pointer, camera);
    
    // (判定対象: 透明なマス + 見えている駒)
    const objectsToIntersect = [...cellObjects, ...pieceMeshes];
    const intersects = raycaster.intersectObjects(objectsToIntersect);

    if (intersects.length > 0) {
        const clickedObj = intersects[0].object; // カメラに一番近いオブジェクト
        const data = clickedObj.userData;

        // --- クリックしたオブジェクトに応じてロジック分岐 ---
        
        let targetR, targetC;
        
        if (data.type === 'cell') { // 透明なマスがクリックされた
            targetR = data.r;
            targetC = data.c;
        } else if (data.type === 'piece') { // 駒がクリックされた
            targetR = data.r;
            targetC = data.c;
        } else {
            return; // 関係ない場所
        }

        // --- 元の onCellClick のロジックを移植 ---
            
        // 1. 何も選択していない時 (駒の選択)
        if (!selectedPiece) {
            if (data.type === 'piece' && data.isTop && data.owner === mySlot) {
                selectedPiece = { from: { type: 'cell', r: data.r, c: data.c }, size: data.size };
                highlightSelection(clickedObj); // 3Dハイライト処理
                addLog(`盤上駒選択: (${data.r},${data.c})`);
                return;
            } else if (data.type === 'cell') {
                addLog('先に手駒を選択してください');
                return;
            }
        }

        // 2. 手駒を選択している時 (手駒の配置)
        if (selectedPiece.from.type === 'hand') {
            const payload = { action: 'place_from_hand', size: selectedPiece.size, to: { r: targetR, c: targetC } };
            socket.emit('place_piece', payload, (ack) => {
                if (ack && ack.error) addLog('エラー: ' + ack.error);
            });
            addLog(`手駒を送信: ${selectedPiece.size} -> (${targetR},${targetC})`);
            clearSelection();
            return;
        }

        // 3. 盤上の駒を選択している時 (駒の移動)
        if (selectedPiece.from.type === 'cell') {
            // 自分自身への移動は選択解除
            if (selectedPiece.from.r === targetR && selectedPiece.from.c === targetC) {
                clearSelection();
                addLog('選択解除');
                return;
            }

            const payload = { action: 'move_on_board', from: { r: selectedPiece.from.r, c: selectedPiece.from.c }, to: { r: targetR, c: targetC } };
            socket.emit('place_piece', payload, (ack) => {
                if (ack && ack.error) addLog('エラー: ' + ack.error);
            });
            addLog(`盤上駒の移動を送信: (${selectedPiece.from.r},${selectedPiece.from.c}) -> (${targetR},${targetC})`);
            clearSelection();
            return;
        }
    }
}

/**
 * (新規) 3D/DOMの選択ハイライト処理
 */
function highlightSelection(meshToHighlight = null) {
    // DOM (手駒) のハイライト
    document.querySelectorAll('.hand-piece').forEach(el => el.classList.remove('selected'));
    if (selectedPiece && selectedPiece.from.type === 'hand') {
        // 同じサイズの最初の手駒をハイライト (元のロジックを流用)
        const el = [...handContainer.children].find(ch => ch.dataset.size === selectedPiece.size);
        if (el) el.classList.add('selected');
    }

    // 3D (盤上) のハイライト
    if (selectedMesh) {
        // 前回の選択を元に戻す
        selectedMesh.material.color.set(COLORS[selectedMesh.userData.owner]);
        selectedMesh = null;
    }
    if (meshToHighlight) {
        // 今回の選択をハイライト
        meshToHighlight.material.color.set(COLORS.selected);
        selectedMesh = meshToHighlight;
    }
    renderer.render(scene, camera); // ハイライトを即時反映
}

/**
 * (新規) 選択解除
 */
function clearSelection() {
    selectedPiece = null;
    highlightSelection(null); // すべてのハイライトを解除
}

/**
 * (新規) ウィンドウリサイズ対応
 */
function onWindowResize() {
    const width = boardWrap.clientWidth;
    const height = 500; // 高さを500pxに固定
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.render(scene, camera); // リサイズ後すぐに再描画
}


// --- 既存のSocket.IOロジック (DOM手駒・ログ・ボタン) ---

function addLog(s){
  const t = new Date().toLocaleTimeString();
  logEl.innerHTML = `<div>[${t}] ${escapeHtml(s)}</div>` + logEl.innerHTML;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/**
 * 手駒 (DOM) の描画
 * (元の renderHand とほぼ同じ)
 */
function renderHandDOM(){
  handContainer.innerHTML = '';
  if (!state || !mySlot || !state.players || mySlot === 'spectator') return;
  
  const me = state.players[mySlot];
  if (!me) return;
  
  // 選択中の手駒をハイライト解除
  if (selectedPiece && selectedPiece.from.type === 'hand') {
      highlightSelection(null);
  }
  
  const sizes = ['large','medium','small'];
  sizes.forEach(size=>{
    const num = me.pieces[size] || 0;
    for (let i=0; i<num; i++){
      const wrapper = document.createElement('div');
      wrapper.className = 'hand-piece';
      const piece = document.createElement('div');
      piece.className = `piece size-${size} color-${mySlot==='A'?'A':'B'}`;
      piece.textContent = ''; // size[0].toUpperCase();
      wrapper.appendChild(piece);
      wrapper.dataset.size = size;
      wrapper.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectedPiece = { from: { type: 'hand'}, size };
        highlightSelection(null); // 3Dハイライトを解除し、DOMハイライトを設定
        addLog(`手駒選択: ${size}`);
      });
      handContainer.appendChild(wrapper);
    }
  });
}


// (ボタンのイベントリスナーはそのまま)
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


// (Socketイベントリスナーはそのまま)
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
    renderHandDOM(); // 割当が決まったら手駒を描画
  }
});
socket.on('start_game', (s) => {
  addLog('ゲーム開始');
  clearSelection();
  render(s);
});
socket.on('update_state', (s) => {
  addLog('状態更新受信');
  render(s); // サーバーから更新が来たら3D描画
});
socket.on('invalid_move', (d) => {
  addLog('不正手: ' + (d && d.reason ? d.reason : 'unknown'));
});
socket.on('game_over', (d) => {
  addLog('ゲーム終了: 勝者 = ' + d.winner);
  clearSelection();
  render(d.state);
});
socket.on('disconnect', () => {
  addLog('サーバー切断');
  mySlot = null;
  render(state || {}); // 状態表示を更新
});

// --- 実行開始 ---
initThree(); // 3Dシーン初期化
buildBoard3D(); // 3D盤面作成
render(state || {}); // 初期状態（空）を描画