(function () {
  'use strict';

  const {
    normalizeHashtags,
    buildIntentURL,
    estimateTweetLength,
    SnippetStore,
    DraftStore,
    SettingsStore
  } = window.TwIntentCore || {};

  // DOM
  const $ = (sel) => document.querySelector(sel);

  // 要素の存在チェック付きで取得
  function getElement(selector) {
    const element = $(selector);
    if (!element) {
      console.warn(`Element not found: ${selector}`);
    }
    return element;
  }

  const textEl = getElement('#text');
  const urlEl = getElement('#url');
  const viaEl = getElement('#via');
  const relatedEl = getElement('#related');
  const tagsEl = getElement('#hashtags');
  const charCountEl = getElement('#charCount');

  const openPopupBtn = getElement('#openPopup');
  const copyUrlBtn = getElement('#copyUrl');
  const compactModeEl = getElement('#compactMode');
  const toggleAdvancedBtn = getElement('#toggleAdvanced');
  const advancedFields = getElement('#advancedFields');

  const snipTypeEl = getElement('#snipType');

  const snipValueEl = getElement('#snipValue');
  const addSnippetBtn = getElement('#addSnippet');
  const textSnippetsEl = getElement('#textSnippets');
  const tagSnippetsEl = getElement('#tagSnippets');
  const exportSnippetsBtn = getElement('#exportSnippets');
  const importSnippetsBtn = getElement('#importSnippets');
  const importFileEl = getElement('#importFile');

  // 設定関連の要素
  const saveDraftTextEl = getElement('#saveDraftText');
  const saveDraftUrlEl = getElement('#saveDraftUrl');
  const saveDraftHashtagsEl = getElement('#saveDraftHashtags');
  const saveDraftViaEl = getElement('#saveDraftVia');
  const saveDraftRelatedEl = getElement('#saveDraftRelated');
  const defaultCompactModeEl = getElement('#defaultCompactMode');
  const resetSettingsBtn = getElement('#resetSettings');


  // Tab functionality
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  function switchTab(targetTab) {
    tabBtns.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    const btn = document.querySelector(`[data-tab="${CSS.escape(targetTab)}"]`);
    const panel = document.getElementById(`${targetTab}-tab`);

    if (!btn || !panel) {
      console.warn('Tab not found:', targetTab);
      return;
    }

    btn.classList.add('active');
    panel.classList.add('active');
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Advanced fields toggle
  function toggleAdvancedFields() {
    if (!advancedFields || !toggleAdvancedBtn) return;
    const isVisible = advancedFields.style.display !== 'none';
    advancedFields.style.display = isVisible ? 'none' : 'block';
    toggleAdvancedBtn.classList.toggle('expanded', !isVisible);
  }

  if (toggleAdvancedBtn) {
    toggleAdvancedBtn.addEventListener('click', toggleAdvancedFields);
  }

  function currentParams() {
    return {
      text: textEl?.value || '',
      url: urlEl?.value || '',
      hashtags: normalizeHashtags(tagsEl?.value || ''),
      via: viaEl?.value || '',
      related: (relatedEl?.value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    };
  }

  function refreshCount() {
    if (!charCountEl) return;

    const params = currentParams();
    const len = estimateTweetLength(params);
    charCountEl.textContent = len;

    // CSS クラスで状態を管理
    const state = len > 280 ? 'over' : len > 260 ? 'warn' : 'ok';
    charCountEl.dataset.state = state;
  }

  // デバウンス付きのドラフト保存
  const persistDraft = (() => {
    let timerId;
    return function persistDraft() {
      clearTimeout(timerId);
      timerId = setTimeout(async () => {
        try {
          await DraftStore.set(currentParams());
        } catch (e) {
          console.error('DraftStore.set failed', e);
        }
      }, 300);
    };
  })();

  function appendTextSnippet(content) {
    if (!textEl) return;

    const start = textEl.selectionStart ?? textEl.value.length;
    const end = textEl.selectionEnd ?? textEl.value.length;
    const before = textEl.value.slice(0, start);
    const after = textEl.value.slice(end);
    const needsSpaceBefore = before && !/\s$/.test(before);
    const needsSpaceAfter = after && !/^\s/.test(after);
    const insertText = (needsSpaceBefore ? ' ' : '') + content + (needsSpaceAfter ? ' ' : '');

    textEl.value = before + insertText + after;
    const caret = (before + insertText).length;
    textEl.setSelectionRange(caret, caret);
    textEl.focus();
    refreshCount();
    persistDraft();
  }

  function addHashtagToField(tag) {
    if (!tagsEl) return;

    const curTags = normalizeHashtags(tagsEl.value);
    const updated = Array.from(new Set([...curTags, tag]));
    tagsEl.value = updated.map((t) => '#' + t).join(' ');
    refreshCount();
    persistDraft();
  }

  function makeChip({ label, onAdd, onDelete }) {
    const div = document.createElement('div');
    div.className = 'chip';

    const span = document.createElement('span');
    span.className = 'label';
    span.textContent = label;
    div.appendChild(span);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn';
    addBtn.title = '追加';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', onAdd);
    div.appendChild(addBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn';
    delBtn.title = '削除';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', onDelete);
    div.appendChild(delBtn);

    return div;
  }

  async function renderSnippets() {
    try {
      const data = await SnippetStore.getAll();
      const texts = data?.texts ?? [];
      const tags = data?.hashtags ?? [];

      if (!textSnippetsEl || !tagSnippetsEl) return;

      textSnippetsEl.innerHTML = '';
      tagSnippetsEl.innerHTML = '';

      const tFrag = document.createDocumentFragment();
      const hFrag = document.createDocumentFragment();

      texts.forEach((t) => {
        const displayLabel = t.content.length > 20 ? t.content.slice(0, 20) + '...' : t.content;
        tFrag.appendChild(
          makeChip({
            label: displayLabel,
            onAdd: () => appendTextSnippet(t.content),
            onDelete: async () => {
              try {
                await SnippetStore.delete('text', t.id);
                renderSnippets();
              } catch (e) {
                console.error('Delete text snippet failed', e);
              }
            }
          })
        );
      });

      tags.forEach((h) => {
        const displayLabel = '#' + h.tag;
        hFrag.appendChild(
          makeChip({
            label: displayLabel,
            onAdd: () => addHashtagToField(h.tag),
            onDelete: async () => {
              try {
                await SnippetStore.delete('hashtag', h.id);
                renderSnippets();
              } catch (e) {
                console.error('Delete hashtag snippet failed', e);
              }
            }
          })
        );
      });

      textSnippetsEl.appendChild(tFrag);
      tagSnippetsEl.appendChild(hFrag);
    } catch (e) {
      console.error('Failed to render snippets', e);
    }
  }

  async function onAddSnippet() {
    if (!snipTypeEl || !snipValueEl || !addSnippetBtn) return;

    const type = snipTypeEl.value;
    const value = snipValueEl.value.trim();

    if (!value) {
      addSnippetBtn.dataset.state = 'error';
      addSnippetBtn.textContent = '値が必要';
      setTimeout(() => {
        addSnippetBtn.dataset.state = '';
        addSnippetBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4.5v15m7.5-7.5h-15"/>
          </svg>
          追加
        `;
      }, 2000);
      return;
    }

    try {
      if (type === 'text') {
        await SnippetStore.addText('', value);
      } else {
        const tag = normalizeHashtags(value)[0];
        if (!tag) {
          addSnippetBtn.dataset.state = 'error';
          addSnippetBtn.textContent = '無効なタグ';
          setTimeout(() => {
            addSnippetBtn.dataset.state = '';
            addSnippetBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4.5v15m7.5-7.5h-15"/>
              </svg>
              追加
            `;
          }, 2000);
          return;
        }
        await SnippetStore.addHashtag('', tag);
      }

      snipValueEl.value = '';
      renderSnippets();

      // 成功表示
      addSnippetBtn.dataset.state = 'success';
      addSnippetBtn.textContent = '追加完了';
      setTimeout(() => {
        addSnippetBtn.dataset.state = '';
        addSnippetBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4.5v15m7.5-7.5h-15"/>
          </svg>
          追加
        `;
      }, 1500);
    } catch (e) {
      console.error('Add snippet failed', e);
      addSnippetBtn.dataset.state = 'error';
      addSnippetBtn.textContent = 'エラー';
      setTimeout(() => {
        addSnippetBtn.dataset.state = '';
        addSnippetBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4.5v15m7.5-7.5h-15"/>
          </svg>
          追加
        `;
      }, 2000);
    }
  }

  function buildUrlFromUi() {
    const params = currentParams();
    return buildIntentURL(params);
  }

  function ensureSomethingToPost() {
    // 空でも投稿を許可（ダイアログなし）
    return true;
  }



  async function onOpenPopup() {
    if (!ensureSomethingToPost()) return;
    const url = buildUrlFromUi();

    // コンパクトモードかどうかでサイズを変更
    const isCompact = compactModeEl.checked;
    const width = isCompact ? 400 : 550;
    const height = isCompact ? 300 : 420;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;

    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      'scrollbars=yes',
      'resizable=yes',
      'toolbar=no',
      'menubar=no',
      'location=no',
      'directories=no',
      'status=no'
    ].join(',');

    window.open(url, 'twitter_intent', features + ',noopener,noreferrer');
  }



  async function onCopyUrl() {
    if (!copyUrlBtn) return;

    const url = buildUrlFromUi();
    try {
      await navigator.clipboard.writeText(url);
      const originalHTML = copyUrlBtn.innerHTML;
      copyUrlBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        コピー完了
      `;
      setTimeout(() => {
        copyUrlBtn.innerHTML = originalHTML;
      }, 1200);
    } catch {
      // フォールバック: エラー表示（execCommandは非推奨のため削除）
      const originalHTML = copyUrlBtn.innerHTML;
      copyUrlBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18L18 6M6 6l12 12"/>
        </svg>
        コピー失敗
      `;
      setTimeout(() => {
        copyUrlBtn.innerHTML = originalHTML;
      }, 2000);
    }
  }

  // テンプレートのエクスポート
  async function onExportSnippets() {
    try {
      const data = await SnippetStore.getAll();

      // エクスポート用のデータ形式に変換
      const exportData = {
        version: "1.0",
        exportDate: new Date().toISOString(),
        templates: {
          texts: data.texts.map(t => ({
            content: t.content,
            createdAt: t.createdAt
          })),
          hashtags: data.hashtags.map(h => ({
            tag: h.tag,
            createdAt: h.createdAt
          }))
        }
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `twitter-intent-templates-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // 成功メッセージ
      const originalHTML = exportSnippetsBtn.innerHTML;
      exportSnippetsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        エクスポート完了
      `;
      setTimeout(() => {
        exportSnippetsBtn.innerHTML = originalHTML;
      }, 2000);
    } catch (error) {
      console.error('Export failed:', error);
      const originalHTML = exportSnippetsBtn.innerHTML;
      exportSnippetsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18L18 6M6 6l12 12"/>
        </svg>
        エクスポート失敗
      `;
      setTimeout(() => {
        exportSnippetsBtn.innerHTML = originalHTML;
      }, 2000);
    }
  }

  // テンプレートのインポート
  async function onImportSnippets() {
    importFileEl.click();
  }

  async function onFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      // 新旧両方のデータ形式に対応
      const dataSource = importData.templates || importData.snippets;
      if (!dataSource || !Array.isArray(dataSource.texts) || !Array.isArray(dataSource.hashtags)) {
        throw new Error('Invalid file format');
      }

      // 既存データを取得
      const existingData = await SnippetStore.getAll();
      const existingTexts = new Set(existingData.texts.map(t => t.content));
      const existingHashtags = new Set(existingData.hashtags.map(h => h.tag));

      // 重複チェック（自動的に重複を除外してインポート）
      const newTexts = dataSource.texts.filter(t => t.content && !existingTexts.has(t.content));
      const newHashtags = dataSource.hashtags.filter(h => h.tag && !existingHashtags.has(h.tag));
      const duplicateCount = (dataSource.texts.length - newTexts.length) + (dataSource.hashtags.length - newHashtags.length);

      // インポート実行（重複を除く）
      let importedCount = 0;

      for (const textTemplate of newTexts) {
        await SnippetStore.addText('', textTemplate.content);
        importedCount++;
      }

      for (const hashtagTemplate of newHashtags) {
        await SnippetStore.addHashtag('', hashtagTemplate.tag);
        importedCount++;
      }

      // UI更新
      renderSnippets();

      // 結果メッセージ
      const originalHTML = importSnippetsBtn.innerHTML;
      let resultMessage = '';

      if (importedCount > 0 && duplicateCount > 0) {
        resultMessage = `${importedCount}件追加 (${duplicateCount}件重複)`;
      } else if (importedCount > 0) {
        resultMessage = `${importedCount}件追加`;
      } else if (duplicateCount > 0) {
        resultMessage = `全て重複済み`;
      } else {
        resultMessage = `データなし`;
      }

      importSnippetsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        ${resultMessage}
      `;
      setTimeout(() => {
        importSnippetsBtn.innerHTML = originalHTML;
      }, 3000);

    } catch (error) {
      console.error('Import failed:', error);
      const originalHTML = importSnippetsBtn.innerHTML;
      importSnippetsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18L18 6M6 6l12 12"/>
        </svg>
        エラー
      `;
      setTimeout(() => {
        importSnippetsBtn.innerHTML = originalHTML;
      }, 3000);
    }

    // ファイル選択をリセット
    event.target.value = '';
  }

  function bindInputs() {
    [textEl, urlEl, viaEl, relatedEl, tagsEl].forEach((el) => {
      if (el) {
        el.addEventListener('input', () => {
          refreshCount();
          persistDraft();
        });
      }
    });
  }

  // 設定の読み込み
  async function loadSettings() {
    try {
      const settings = await SettingsStore.get();

      // ドラフト保存設定を反映
      if (saveDraftTextEl) saveDraftTextEl.checked = settings.saveDraft.text;
      if (saveDraftUrlEl) saveDraftUrlEl.checked = settings.saveDraft.url;
      if (saveDraftHashtagsEl) saveDraftHashtagsEl.checked = settings.saveDraft.hashtags;
      if (saveDraftViaEl) saveDraftViaEl.checked = settings.saveDraft.via;
      if (saveDraftRelatedEl) saveDraftRelatedEl.checked = settings.saveDraft.related;

      // その他の設定
      if (defaultCompactModeEl) defaultCompactModeEl.checked = settings.compactMode;
      if (compactModeEl) compactModeEl.checked = settings.compactMode;
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  }

  // 設定の保存
  async function saveSettings() {
    try {
      const settings = {
        saveDraft: {
          text: saveDraftTextEl?.checked ?? false,
          url: saveDraftUrlEl?.checked ?? true,
          hashtags: saveDraftHashtagsEl?.checked ?? true,
          via: saveDraftViaEl?.checked ?? true,
          related: saveDraftRelatedEl?.checked ?? true
        },
        compactMode: defaultCompactModeEl?.checked ?? false
      };

      await SettingsStore.set(settings);

      // コンパクトモードの設定を作成タブにも反映
      if (compactModeEl) {
        compactModeEl.checked = settings.compactMode;
      }
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  }

  // 設定リセット
  async function onResetSettings() {
    if (!resetSettingsBtn) return;

    try {
      await SettingsStore.reset();
      await loadSettings();

      // 成功メッセージ
      const originalHTML = resetSettingsBtn.innerHTML;
      resetSettingsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        リセット完了
      `;
      setTimeout(() => {
        resetSettingsBtn.innerHTML = originalHTML;
      }, 2000);
    } catch (e) {
      console.error('Failed to reset settings', e);
      const originalHTML = resetSettingsBtn.innerHTML;
      resetSettingsBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18L18 6M6 6l12 12"/>
        </svg>
        エラー
      `;
      setTimeout(() => {
        resetSettingsBtn.innerHTML = originalHTML;
      }, 2000);
    }
  }

  async function loadDraft() {
    const draft = await DraftStore.get();
    if (draft) {
      if (textEl) textEl.value = draft.text || '';
      if (urlEl) urlEl.value = draft.url || '';
      if (viaEl) viaEl.value = draft.via || '';
      if (relatedEl) relatedEl.value = (draft.related || []).join(', ');
      if (tagsEl) tagsEl.value = (draft.hashtags || []).map(tag => '#' + tag).join(' ');
    }
    refreshCount();
  }

  // Event listeners with null checks
  if (openPopupBtn) openPopupBtn.addEventListener('click', onOpenPopup);
  if (copyUrlBtn) copyUrlBtn.addEventListener('click', onCopyUrl);
  if (addSnippetBtn) addSnippetBtn.addEventListener('click', onAddSnippet);
  if (exportSnippetsBtn) exportSnippetsBtn.addEventListener('click', onExportSnippets);
  if (importSnippetsBtn) importSnippetsBtn.addEventListener('click', onImportSnippets);
  if (importFileEl) importFileEl.addEventListener('change', onFileSelected);

  // 設定関連のイベントリスナー
  if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', onResetSettings);

  // 設定変更時の自動保存
  [saveDraftTextEl, saveDraftUrlEl, saveDraftHashtagsEl, saveDraftViaEl, saveDraftRelatedEl, defaultCompactModeEl].forEach(el => {
    if (el) {
      el.addEventListener('change', saveSettings);
    }
  });

  // 初期化関数
  async function init() {
    if (!window.TwIntentCore) {
      console.error('TwIntentCore not found');
      return;
    }

    bindInputs();

    try {
      await loadSettings();
      await loadDraft();
      await renderSnippets();
    } catch (e) {
      console.error('Initialization failed', e);
    }
  }

  // DOM読み込み完了を待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init().catch(console.error));
  } else {
    init().catch(console.error);
  }
})();