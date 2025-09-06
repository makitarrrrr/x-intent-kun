/**
 * Twitter Web Intent helper core
 * - URL組み立て
 * - ハッシュタグ正規化
 * - 長さ推定（簡易）
 * - ストレージ抽象
 * - スニペット管理
 */
(function (global) {
  'use strict';

  const X_INTENT_BASE = 'https://x.com/intent/tweet'; // twitter.comでも可
  const STORAGE_NAMESPACE = 'twIntent';
  const SCHEMA_VERSION = 1;

  // 小ユーティリティ
  const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
  const uniq = (arr) => Array.from(new Set(arr));
  const nowIso = () => new Date().toISOString();

  // ハッシュタグ正規化: '#tag', ' tag ', ['#Tag','tag'] などを ['tag'] に
  function normalizeHashtags(input) {
    if (!input) return [];
    let arr = [];
    if (Array.isArray(input)) {
      arr = input;
    } else if (typeof input === 'string') {
      arr = input.split(/[,\s]+/);
    } else {
      return [];
    }
    return uniq(
      arr
        .map((t) => (t || '').toString().trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t.slice(1) : t))
        .map((t) => t.replace(/[#\s]/g, '')) // 念のため
        .filter(Boolean)
    );
  }

  // Intent URLを構築
  function buildIntentURL(params) {
    const {
      text = '',
      url = '',
      hashtags = [],
      via = '',
      related = []
    } = params || {};

    const qs = [];
    if (isNonEmptyString(text)) qs.push('text=' + encodeURIComponent(text));
    if (isNonEmptyString(url)) qs.push('url=' + encodeURIComponent(url));

    const tags = normalizeHashtags(hashtags);
    if (tags.length > 0) qs.push('hashtags=' + encodeURIComponent(tags.join(',')));

    if (isNonEmptyString(via)) {
      const viaHandle = via.replace(/^@/, '').trim();
      if (viaHandle) qs.push('via=' + encodeURIComponent(viaHandle));
    }

    const relatedArr = Array.isArray(related)
      ? related
      : (isNonEmptyString(related) ? related.split(',') : []);
    const relatedNorm = relatedArr
      .map((h) => (h || '').toString().trim())
      .filter(Boolean)
      .map((h) => h.replace(/^@/, ''));
    if (relatedNorm.length > 0) {
      qs.push('related=' + encodeURIComponent(uniq(relatedNorm).join(',')));
    }

    const query = qs.join('&');
    return X_INTENT_BASE + (query ? '?' + query : '');
  }

  // 簡易の文字数推定（実際のXのカウントとは仕様差の可能性あり）
  // - URLはそのままの文字数でカウント
  // - hashtagsは "#tag" としてスペース区切りで末尾に連結される想定で加算
  // - viaは " via @user" として加算
  // - relatedはカウントに含まれない（Intent上の推奨ユーザー用）
  function estimateTweetLength(params) {
    const { text = '', url = '', hashtags = [], via = '' } = params || {};
    let count = (text || '').trim().length;

    if (isNonEmptyString(url)) {
      // URLをそのままの長さでカウント（スペース1つも加算）
      count += 1 + url.trim().length;
    }

    const tags = normalizeHashtags(hashtags);
    if (tags.length > 0) {
      const hashStr = tags.map((t) => '#' + t).join(' ');
      count += 1 + hashStr.length; // 先頭スペース + タグ列
    }

    if (isNonEmptyString(via)) {
      const handle = via.replace(/^@/, '').trim();
      if (handle) {
        count += (' via @' + handle).length;
      }
    }
    return count;
  }

  // ストレージ抽象: chrome.storage.sync -> chrome.storage.local -> localStorage
  const StorageAdapter = (() => {
    const hasChromeSync = typeof chrome !== 'undefined' && chrome?.storage?.sync;
    const hasChromeLocal = typeof chrome !== 'undefined' && chrome?.storage?.local;

    if (hasChromeSync) {
      return {
        type: 'chrome-sync',
        async get(key, defVal) {
          return new Promise((resolve) => {
            chrome.storage.sync.get([key], (res) => {
              resolve(res[key] !== undefined ? res[key] : defVal);
            });
          });
        },
        async set(key, val) {
          return new Promise((resolve) => {
            chrome.storage.sync.set({ [key]: val }, () => resolve(true));
          });
        }
      };
    }
    if (hasChromeLocal) {
      return {
        type: 'chrome-local',
        async get(key, defVal) {
          return new Promise((resolve) => {
            chrome.storage.local.get([key], (res) => {
              resolve(res[key] !== undefined ? res[key] : defVal);
            });
          });
        },
        async set(key, val) {
          return new Promise((resolve) => {
            chrome.storage.local.set({ [key]: val }, () => resolve(true));
          });
        }
      };
    }
    // Fallback to localStorage
    return {
      type: 'localStorage',
      async get(key, defVal) {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : defVal;
        } catch {
          return defVal;
        }
      },
      async set(key, val) {
        try {
          localStorage.setItem(key, JSON.stringify(val));
          return true;
        } catch {
          return false;
        }
      }
    };
  })();

  // スニペットの型
  // text: {id, label, content, createdAt, updatedAt}
  // hashtag: {id, label, tag, createdAt, updatedAt}
  const defaultSnippets = { version: SCHEMA_VERSION, texts: [], hashtags: [] };

  const SnippetStore = {
    key: `${STORAGE_NAMESPACE}/snippets`,
    async getAll() {
      const data = await StorageAdapter.get(this.key, defaultSnippets);
      // マイグレーション
      if (!data.version) data.version = SCHEMA_VERSION;
      if (!Array.isArray(data.texts)) data.texts = [];
      if (!Array.isArray(data.hashtags)) data.hashtags = [];
      return data;
    },
    async saveAll(data) {
      data.version = SCHEMA_VERSION;
      return StorageAdapter.set(this.key, data);
    },
    _id() {
      return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    },
    async addText(label, content) {
      const data = await this.getAll();
      const item = {
        id: this._id(),
        label: (label || '').trim() || content.slice(0, 24),
        content: content || '',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      data.texts.push(item);
      await this.saveAll(data);
      return item;
    },
    async addHashtag(label, tag) {
      const data = await this.getAll();
      const cleanTag = normalizeHashtags(tag)[0] || '';
      const item = {
        id: this._id(),
        label: (label || '').trim() || ('#' + cleanTag),
        tag: cleanTag,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      data.hashtags.push(item);
      await this.saveAll(data);
      return item;
    },
    async delete(kind, id) {
      const data = await this.getAll();
      if (kind === 'text') data.texts = data.texts.filter((t) => t.id !== id);
      if (kind === 'hashtag') data.hashtags = data.hashtags.filter((t) => t.id !== id);
      await this.saveAll(data);
    },
    async update(kind, id, patch) {
      const data = await this.getAll();
      const list = kind === 'text' ? data.texts : data.hashtags;
      const idx = list.findIndex((t) => t.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch, updatedAt: nowIso() };
        await this.saveAll(data);
        return list[idx];
      }
      return null;
    }
  };

  // 設定管理
  const defaultSettings = {
    saveDraft: {
      text: false,      // 本文は保存しない（デフォルト）
      url: true,        // URLは保存する
      hashtags: true,   // ハッシュタグは保存する
      via: true,        // Viaは保存する
      related: true     // 関連アカウントは保存する
    },
    compactMode: false
  };

  const SettingsStore = {
    key: `${STORAGE_NAMESPACE}/settings`,
    async get() {
      const settings = await StorageAdapter.get(this.key, defaultSettings);
      // デフォルト値とマージして不足項目を補完
      return {
        saveDraft: { ...defaultSettings.saveDraft, ...settings.saveDraft },
        compactMode: settings.compactMode ?? defaultSettings.compactMode
      };
    },
    async set(settings) {
      return StorageAdapter.set(this.key, {
        ...settings,
        updatedAt: nowIso()
      });
    },
    async reset() {
      return this.set(defaultSettings);
    }
  };

  // 前回入力の保存（設定に応じて）
  const DraftStore = {
    key: `${STORAGE_NAMESPACE}/draft`,
    async get() {
      return StorageAdapter.get(this.key, null);
    },
    async set(draft) {
      const settings = await SettingsStore.get();
      const filteredDraft = {};
      
      // 設定に応じて保存する項目を決定
      if (settings.saveDraft.text) filteredDraft.text = draft.text;
      if (settings.saveDraft.url) filteredDraft.url = draft.url;
      if (settings.saveDraft.hashtags) filteredDraft.hashtags = draft.hashtags;
      if (settings.saveDraft.via) filteredDraft.via = draft.via;
      if (settings.saveDraft.related) filteredDraft.related = draft.related;
      
      return StorageAdapter.set(this.key, {
        ...filteredDraft,
        updatedAt: nowIso()
      });
    }
  };

  // 公開API
  const Core = {
    X_INTENT_BASE,
    normalizeHashtags,
    buildIntentURL,
    estimateTweetLength,
    StorageAdapter,
    SnippetStore,
    DraftStore,
    SettingsStore
  };

  // export
  global.TwIntentCore = Core;
})(typeof window !== 'undefined' ? window : globalThis);
