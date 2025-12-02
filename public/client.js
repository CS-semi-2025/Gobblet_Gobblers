// client.js (Three.js version - Multi-room ready)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // ★この行を追加

// --- Socket.IO 接続 ---
const socket = io();

// --- UI参照 ---
// ホーム画面用
const homeScreen = document.getElementById("homeScreen");
const createRoomBtn = document.getElementById("createRoomBtn");
const roomInput = document.getElementById("roomInput");
const homeNameInput = document.getElementById("homeNameInput");

// UI参照　(ログ、ステータスパネル、ボタン類はDOMのまま)ゲーム画面用
const gameScreen = document.getElementById("gameScreen");
const logEl = document.getElementById('log');
const meLabel = document.getElementById('meLabel');
const turnLabel = document.getElementById('turnLabel');
const gameStateLabel = document.getElementById('gameStateLabel');
const currentRoomLabel = document.getElementById('currentRoomLabel'); // 追加
const gameNameInput = document.getElementById('nameInput');
const boardWrap = document.querySelector('.board-wrap');
const handContainer = document.getElementById('handContainer');

// 以下にモーダルUI用の要素追加
// ★ 新規: モーダルUIの要素取得
const settingsBtn = document.getElementById('settingsBtn');
const modalOverlay = document.getElementById('modalOverlay');
const closeModalBtn = document.getElementById('closeModalBtn');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const modalRestartBtn = document.getElementById('modalRestartBtn');
const modalLeaveBtn = document.getElementById('modalLeaveBtn');
const toggleHighlightBtn = document.getElementById('toggleHighlightBtn');

// グローバル変数
let mySlot = null;
let myId = null;
let state = null;
let selectedPiece = null; 
let currentRoomID = null; // 現在のルームIDを保持

// 設定値の追加
// ★ 新規: 設定値
let config = {
    highlightMoves: true
};

// URLパラメータにroomがあれば自動入力
const params = new URLSearchParams(window.location.search);
if (params.get('room')) {
    roomInput.value = params.get('room');
}

// --- ▼▼▼ 画面遷移・入室ロジック ▼▼▼ ---

createRoomBtn.addEventListener("click", () => {
    const roomVal = roomInput.value.trim();
    const nameVal = homeNameInput.value.trim();

    if (!roomVal || !nameVal) {
        alert("ルーム名とプレイヤー名を入力して下さい");
        return;
    }

    // サーバーへ送信するデータ（将来的にサーバーがルーム対応したときに機能する）
    const joinData = {
        room: roomVal, 
        name: nameVal
    };

    // サーバーへJoinリクエスト
    socket.emit("join", joinData, (ack) => {
        // サーバーからのコールバック
        if (ack && (ack.ok || ack.slot)) {
            // 参加成功
            mySlot = ack.slot;
            currentRoomID = roomVal;
            
            // 画面情報の更新
            currentRoomLabel.textContent = currentRoomID;
            gameNameInput.value = nameVal;
            
            addLog(`ルーム「${currentRoomID}」に参加しました (Role: ${mySlot})`);
            if (mySlot === 'spectator') addLog('観戦モードです');

            // ★画面切り替え実行★
            toggleScreen(true);

            // URLを更新（リロードしても部屋がわかるように）
            const newUrl = `${window.location.pathname}?room=${encodeURIComponent(currentRoomID)}`;
            window.history.pushState({ path: newUrl }, '', newUrl);

        } else {
            // 参加失敗
            const errorMsg = ack && ack.error ? ack.error : "参加できませんでした";
            alert("エラー: " + errorMsg);
        }
    });
});

// 画面切り替え関数
function toggleScreen(showGame) {
    if (showGame) {
        homeScreen.style.display = "none";
        gameScreen.style.display = "block";
        // 重要: display:none解除直後はCanvasサイズがおかしくなるのでリサイズ発火
        onWindowResize();
    } else {
        homeScreen.style.display = "flex";
        gameScreen.style.display = "none";
    }
}


// --- ▼▼▼ Three.js セットアップ (基本そのまま) ▼▼▼ ---
let scene, camera, renderer, raycaster, pointer;
let controls;

let boardGroup; 
let pieceMeshes = []; 
const cellObjects = []; 
let selectedMesh = null; 

// 色の定義 (CSSと合わせる)
const COLORS = {
    A: 0x1f78b4,
    B: 0xef6c00,
    board: 0xffffff,
    selected: 0xfacc15 
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

    // ★ここから追加: OrbitControls の初期化
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // 滑らかな動き
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false; // パンを無効化（縦方向の移動制限）
    controls.maxPolarAngle = Math.PI / 2.1; // カメラの縦回転を制限 (真下から見えないように)
    controls.minDistance = 8; // 最少ズーム距離
    controls.maxDistance = 25; // 最大ズーム距離
    // ★ここまで追加

    // レイキャスター (クリック判定用)
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    // イベントリスナー
    renderer.domElement.addEventListener('click', onCanvasClick); // 3Dクリック
    window.addEventListener('resize', onWindowResize);

    // ★追加: アニメーションループを開始 (controlsを更新するため)
    animate();
}

// ★追加: アニメーションループ
function animate() {
    requestAnimationFrame(animate);

    if (controls) { // controlsが定義されていることを確認
        controls.update(); 
    }
    renderer.render(scene, camera);
}


//チャットメッセージ処理
  const chatMessages = document.getElementById("chatMessages");
  const chatInput = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");


  //tyatto
  function appendChat(msg) {
    const time = new Date(msg.time).toLocaleTimeString();
    const div = document.createElement("div");
    div.innerHTML = `<strong>${escapeHtml(msg.name)}</strong>: ${escapeHtml(msg.text)} <span style="color:#888;font-size:11px;">(${time})</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }


  // ボタンで送信
  chatSendBtn.onclick = () => {
    const text = chatInput.value.trim();//入力欄からもじしゅとく
    if (!text) return;//からチェック
    socket.emit("chat_message", { text });//送信
    chatInput.value = "";//もう一度からに
  };

  // Enter キーで送信
  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter") chatSendBtn.onclick();
  });

  // サーバーからの通常メッセージ受信
  socket.on("chat_message", (msg) => {
    appendChat(msg);
  });

  // サーバーからじゅしん
  socket.on("chat_init", (log) => {
    log.forEach(msg => appendChat(msg));
  });

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

    // ★ここから追加: マスの区切り線
    const lineColor = new THREE.Color(0xdde5ed); // 少し暗めの色
    const lineMaterial = new THREE.MeshBasicMaterial({ color: lineColor });
    const lineThickness = 0.1; // 線の太さ

    // 縦線
    for (let i = 1; i < 3; i++) {
        const lineGeo = new THREE.BoxGeometry(lineThickness, 0.25, CELL_GAP * 3 + lineThickness * 2); // 盤面より少し高い
        const lineMesh = new THREE.Mesh(lineGeo, lineMaterial);
        lineMesh.position.set(i * CELL_GAP + BOARD_OFFSET - CELL_GAP / 2, 0.1, 0); // 中央に配置
        boardGroup.add(lineMesh);
    }
    // 横線
    for (let i = 1; i < 3; i++) {
        const lineGeo = new THREE.BoxGeometry(CELL_GAP * 3 + lineThickness * 2, 0.25, lineThickness);
        const lineMesh = new THREE.Mesh(lineGeo, lineMaterial);
        lineMesh.position.set(0, 0.1, i * CELL_GAP + BOARD_OFFSET - CELL_GAP / 2); // 中央に配置
        boardGroup.add(lineMesh);
    }
    // ★ここまで追加

    // 3x3のクリック判定用マス (透明)
    const cellGeo = new THREE.BoxGeometry(3, 0.1, 3); // マスのサイズ
    cellGeo.translate(0, 0.15, 0); // 盤面よりわずかに上

    // 描画バグの解消必要
    const cellMat = new THREE.MeshBasicMaterial({ 
        color: 0xff0000, 
        transparent: true, 
        opacity: 0,
        depthWrite: false // ★これが重要！透明な物体が後ろを隠さないようにする
    });

    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const cell = new THREE.Mesh(cellGeo, cellMat);
            cell.position.set(c * CELL_GAP + BOARD_OFFSET, 0, r * CELL_GAP + BOARD_OFFSET);
            cell.userData = { type: 'cell', r, c }; 
            boardGroup.add(cell);
            cellObjects.push(cell); 
        }
    }
    scene.add(boardGroup);
}

function createPieceMesh(size, owner) {
    const { r, h } = PIECE_SIZES[size];
    const geometry = new THREE.CylinderGeometry(r, r, h, 32);
    const color = COLORS[owner];
    const material = new THREE.MeshStandardMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
}

function render(stateObj) {
    state = stateObj;
    
    turnLabel.textContent = state.currentTurn || '—';
    gameStateLabel.textContent = state.winner ? `終了: ${state.winner}` : (state.started ? '進行中' : '待機中');
    meLabel.textContent = mySlot ? `${mySlot}` : '未割当';

    pieceMeshes.forEach(mesh => scene.remove(mesh));
    pieceMeshes = [];

    if (state.board) {
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const stack = (state.board[r] && state.board[r][c]) ? state.board[r][c] : [];
                const x = c * CELL_GAP + BOARD_OFFSET;
                const z = r * CELL_GAP + BOARD_OFFSET;
                let currentHeight = 0;
                for (let i = 0; i < stack.length; i++) {
                    const p = stack[i]; 
                    const pieceMesh = createPieceMesh(p.size, p.owner);
                    const y = currentHeight + pieceMesh.geometry.parameters.height / 2 + 0.1;
                    pieceMesh.position.set(x, y, z);
                    pieceMesh.userData = { 
                        type: 'piece', 
                        r, c, 
                        size: p.size, 
                        owner: p.owner, 
                        isTop: (i === stack.length - 1) 
                    };
                    scene.add(pieceMesh);
                    pieceMeshes.push(pieceMesh); 
                    currentHeight += pieceMesh.geometry.parameters.height * 0.2; 
                }
            }
        }
    }
    renderHandDOM();
}

function onCanvasClick(event) {
    if (!state.started && !state.winner) return; // ゲーム中以外は反応しない

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const objectsToIntersect = [...cellObjects, ...pieceMeshes];
    const intersects = raycaster.intersectObjects(objectsToIntersect);

    if (intersects.length > 0) {
        const clickedObj = intersects[0].object; 
        const data = clickedObj.userData;
        let targetR, targetC;
        
        if (data.type === 'cell') { 
            targetR = data.r;
            targetC = data.c;
        } else if (data.type === 'piece') { 
            targetR = data.r;
            targetC = data.c;
        } else {
            return; 
        }
            
        // 1. 選択なし -> 盤上駒選択
        if (!selectedPiece) {
            if (data.type === 'piece' && data.isTop && data.owner === mySlot) {
                selectedPiece = { from: { type: 'cell', r: data.r, c: data.c }, size: data.size };
                highlightSelection(clickedObj); 
                addLog(`盤上駒選択: (${data.r},${data.c})`);
                return;
            } else if (data.type === 'cell') {
                addLog('先に手駒を選択してください');
                return;
            }
        }

        // payloadに roomID を含める（サーバー実装用）
        const basePayload = { room: currentRoomID }; 

        // 2. 手駒配置
        if (selectedPiece.from.type === 'hand') {
            const payload = { 
                ...basePayload,
                action: 'place_from_hand', 
                size: selectedPiece.size, 
                to: { r: targetR, c: targetC } 
            };
            socket.emit('place_piece', payload, (ack) => {
                if (ack && ack.error) addLog('エラー: ' + ack.error);
            });
            addLog(`手駒を送信: ${selectedPiece.size} -> (${targetR},${targetC})`);
            clearSelection();
            return;
        }

        // 3. 盤上移動
        if (selectedPiece.from.type === 'cell') {
            if (selectedPiece.from.r === targetR && selectedPiece.from.c === targetC) {
                clearSelection();
                addLog('選択解除');
                return;
            }
            const payload = { 
                ...basePayload,
                action: 'move_on_board', 
                from: { r: selectedPiece.from.r, c: selectedPiece.from.c }, 
                to: { r: targetR, c: targetC } 
            };
            socket.emit('place_piece', payload, (ack) => {
                if (ack && ack.error) addLog('エラー: ' + ack.error);
            });
            addLog(`盤上駒の移動を送信: (${selectedPiece.from.r},${selectedPiece.from.c}) -> (${targetR},${targetC})`);
            clearSelection();
            return;
        }
    }
}

function highlightSelection(meshToHighlight = null) {
    document.querySelectorAll('.hand-piece').forEach(el => el.classList.remove('selected'));
    if (selectedPiece && selectedPiece.from.type === 'hand') {
        const el = [...handContainer.children].find(ch => ch.dataset.size === selectedPiece.size);
        if (el) el.classList.add('selected');
    }
    if (selectedMesh) {
        selectedMesh.material.color.set(COLORS[selectedMesh.userData.owner]);
        selectedMesh = null;
    }
    if (meshToHighlight) {
        meshToHighlight.material.color.set(COLORS.selected);
        selectedMesh = meshToHighlight;
    }
    renderer.render(scene, camera);
}

function clearSelection() {
    selectedPiece = null;
    highlightSelection(null); 
}

function onWindowResize() {
    // コンテナが非表示の場合は処理しない（0除算などでバグるため）
    if (boardWrap.clientWidth === 0) return;

    const width = boardWrap.clientWidth;
    const height = 500; 
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}


// --- 既存のSocket.IOロジック (DOM手駒・ログ) ---

function addLog(s){
  const t = new Date().toLocaleTimeString();
  logEl.innerHTML = `<div>[${t}] ${escapeHtml(s)}</div>` + logEl.innerHTML;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function renderHandDOM(){
  handContainer.innerHTML = '';
  if (!state || !mySlot || !state.players || mySlot === 'spectator') return;
  
  const me = state.players[mySlot];
  if (!me) return;
  
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
      piece.textContent = ''; 
      wrapper.appendChild(piece);
      wrapper.dataset.size = size;
      wrapper.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectedPiece = { from: { type: 'hand'}, size };
        highlightSelection(null); 
        addLog(`手駒選択: ${size}`);
      });
      handContainer.appendChild(wrapper);
    }
  });
}

// 以下にモーダル関連のイベントリスナー追加
// --- ★ 新規: モーダル関連のイベントリスナー ---
// 1. モーダル開閉
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        console.log('モーダルを開きます');
        modalOverlay.classList.remove('hidden');
    });
}
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
        modalOverlay.classList.add('hidden');
    });
}
if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            modalOverlay.classList.add('hidden');
        }
    });
}

// 2. タブ切り替え
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.dataset.tab;
        const targetContent = document.getElementById(targetId);
        if (targetContent) targetContent.classList.add('active');
    });
});

// 3. モーダル内のアクションボタン
if (modalRestartBtn) {
    modalRestartBtn.addEventListener('click', () => {
        socket.emit('restart_game', {}, (ack) => {
            if (ack && ack.ok) addLog('再戦リクエスト送信');
            else if (ack && ack.error) addLog('再戦失敗: ' + ack.error);
        });
        modalOverlay.classList.add('hidden');
    });
}

if (modalLeaveBtn) {
    modalLeaveBtn.addEventListener('click', () => {
        socket.disconnect();
        modalOverlay.classList.add('hidden');
        // ソケット切断・再接続してホームに戻るイメージ
        // （簡易的にリロードで対応するのが一番バグが少ないです）
        if(confirm("退出してホームに戻りますか？")){
            window.location.href = window.location.pathname; 
        }
        addLog('退出しました');
    });
}

// 4. 設定トグル (ハイライト)
if (toggleHighlightBtn) {
    toggleHighlightBtn.addEventListener('click', () => {
        config.highlightMoves = !config.highlightMoves;
        if (config.highlightMoves) {
            toggleHighlightBtn.classList.add('on');
            toggleHighlightBtn.textContent = 'ON';
        } else {
            toggleHighlightBtn.classList.remove('on');
            toggleHighlightBtn.textContent = 'OFF';
            if (selectedMesh) {
                selectedMesh.material.color.set(COLORS[selectedMesh.userData.owner]);
                selectedMesh = null;
                renderer.render(scene, camera);
            }
        }
    });
}


// --- Socketイベントリスナー ---
socket.on('connect', () => {
  myId = socket.id;
  // addLog('サーバー接続: ' + myId); // ログがうるさいのでコメントアウト
});
socket.on('init', (s) => {
  // initは接続直後に来るが、まだ部屋に入っていないのでここでは描画しない
  // ただし、再接続時などの処理が必要ならここに書く
});
socket.on('assign', (d) => {
    // createRoomBtn内のコールバックで処理するため、ここではログ出し程度
    if(d && d.slot) addLog(`(System) Role Assigned: ${d.slot}`);
});
socket.on('start_game', (s) => {
  addLog('ゲーム開始！');
  clearSelection();
  render(s);
});
socket.on('update_state', (s) => {
  // 自分が参加している部屋の状態更新だけ反映したいが、
  // 現在のサーバー実装は全配信なのでそのまま受け取る
  render(s); 
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
});

// --- 実行開始 ---
initThree(); 
buildBoard3D(); 
if (controls) {
    controls.update(); 
}
renderer.render(scene, camera); // ★初期描画を明示的に呼び出す