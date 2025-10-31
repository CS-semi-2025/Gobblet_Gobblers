// このコードは、ゲームロジックではなく、
// モックアップのUI（モーダルやタブ）を操作するためだけのものです。

document.addEventListener('DOMContentLoaded', () => {

    // --- モーダルの開閉 ---
    const settingsButton = document.getElementById('settings-button');
    const modalOverlay = document.getElementById('modal-overlay');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalButton = document.getElementById('close-modal-button');

    // モーダルを開く関数
    const openModal = () => {
        modalOverlay.classList.remove('hidden');
        settingsModal.classList.remove('hidden');
    };

    // モーダルを閉じる関数
    const closeModal = () => {
        modalOverlay.classList.add('hidden');
        settingsModal.classList.add('hidden');
    };

    // イベントリスナーを設定
    settingsButton.addEventListener('click', openModal);
    closeModalButton.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal); // 背景クリックでも閉じる

    
    // --- モーダルのタブ切り替え ---
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            
            // 1. すべてのタブと中身から .active クラスを削除
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // 2. クリックされたタブに .active クラスを追加
            button.classList.add('active');

            // 3. 対応する中身を表示
            // (data-tab 属性の値 (例: "tab-content-settings") を使って対応するIDを見つける)
            const targetTabId = button.dataset.tab;
            const targetContent = document.getElementById(targetTabId);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });

});