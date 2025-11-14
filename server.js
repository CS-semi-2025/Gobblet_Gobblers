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

// 1. HTTPサーバーを作成します
const httpServer = http.createServer((req, res) => {
    // ブラウザからリクエストされたURL (例: "/", "/style.css", "/script.js")
    let filePath = req.url;
    
    // ルートURL ("/") がリクエストされた場合は、index.html を返す
    if (filePath === '/') {
        filePath = '/index.html';
    }

    // ファイルの拡張子に基づいてContent-Type（ファイルの種類）を決定
    let contentType = 'text/html'; // デフォルト
    const extname = path.extname(filePath);
    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
    }

    // 'public' フォルダ内の対応するファイルパスを生成
    const fullPath = path.join(__dirname, 'public', filePath);

    // 2. ファイルを読み込んでブラウザに返す
    fs.readFile(fullPath, (err, content) => {
        if (err) {
            // ファイルが見つからない場合 (404 Not Found)
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('404 - File Not Found');
            } else {
                // その他のサーバーエラー (500)
                res.writeHead(500);
                res.end('500 - Server Error');
            }
        } else {
            // ファイルが見つかった場合、正常に返す (200 OK)
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// 3. WebSocketサーバーを、既存のHTTPサーバーにアタッチ（接続）します
//   (ポートを別々にするのではなく、同じ3000ポートを共有します)
const wss = new WebSocket.Server({ server: httpServer });

// 4. HTTPサーバーを3000番ポートで起動します
httpServer.listen(3000, () => {
    console.log('HTTPサーバーとチャットサーバーがポート3000で起動しました。');
    console.log('ブラウザで http://localhost:3000 を開いてください。');
});


// --- 以下は元のWebSocketサーバーのロジック（変更なし） ---

// 新しいクライアントからの接続があった場合の処理
wss.on('connection', ws => {
  console.log('クライアントが接続しました。');

  // クライアントからメッセージを受信した場合の処理
  ws.on('message', message => {
    const receivedMessage = message.toString();
    console.log('受信: %s', receivedMessage);

    // 接続している全てのクライアントにメッセージを送信(ブロードキャスト)
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(receivedMessage);
      }
    });
  });

  // 接続が切断された場合の処理
  ws.on('close', () => {
    console.log('クライアントとの接続が切れました。');
  });

  // エラーが発生した場合の処理
  ws.on('error', error => {
    console.error('エラーが発生しました:', error);
  });
});