/**
 * Idoll — Save/Load/Export/Import with checkpoint (resume by label).
 * Requires: startup.txt has *create _idoll_checkpoint ""
 * Engine: restoreGame sets scene.targetLabel from state.stats._idoll_checkpoint when userRestored.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'idoll_save_system';
  var EXPORT_FILENAME = 'idoll-save.json';

  function getStats() {
    try {
      return (window.stats && typeof window.stats === 'object') ? window.stats : null;
    } catch (e) {
      return null;
    }
  }

  function deepClone(val) {
    if (val === null || typeof val !== 'object') return val;
    if (typeof val === 'function') return undefined;
    if (Array.isArray(val)) {
      var arr = [];
      for (var i = 0; i < val.length; i++) arr.push(deepClone(val[i]));
      return arr;
    }
    var obj = {};
    for (var k in val) {
      if (Object.prototype.hasOwnProperty.call(val, k)) obj[k] = deepClone(val[k]);
    }
    return obj;
  }

  function serializeStatsObject(stats) {
    if (!stats || typeof stats !== 'object') return null;
    var out = {};
    var sceneName = null;
    for (var key in stats) {
      if (!Object.prototype.hasOwnProperty.call(stats, key)) continue;
      if (key === 'scene') {
        if (stats.scene && typeof stats.scene.name !== 'undefined') sceneName = stats.scene.name;
        continue;
      }
      try {
        out[key] = deepClone(stats[key]);
      } catch (e) {
        out[key] = stats[key];
      }
    }
    if (sceneName !== null) out.sceneName = sceneName;
    return out;
  }

  /** Current scene index from live stats.sceneName */
  function getCurrentSceneIndex() {
    var stats = getStats();
    if (stats && stats.sceneName && window.nav && window.nav._sceneList) {
      var idx = window.nav._sceneList.indexOf(stats.sceneName);
      if (idx >= 0) return idx;
    }
    if (typeof window.idollCurrentSceneIndex === 'number' && window.idollCurrentSceneIndex >= 0) return window.idollCurrentSceneIndex;
    return null;
  }

  /** Label at or before current line (for checkpoint resume). */
  function getCurrentLabel(scene) {
    if (!scene || typeof scene.lineNum !== 'number' || !scene.labels || typeof scene.labels !== 'object') return '';
    var lineNum = scene.lineNum;
    var bestLine = -1;
    var bestLabel = '';
    for (var name in scene.labels) {
      if (!Object.prototype.hasOwnProperty.call(scene.labels, name)) continue;
      var line = scene.labels[name];
      if (line <= lineNum && line > bestLine) {
        bestLine = line;
        bestLabel = name;
      }
    }
    return bestLabel;
  }

  function getFullState() {
    var stats = getStats();
    if (!stats || typeof stats !== 'object') return null;
    var version = (typeof window !== 'undefined' && window.version) ? window.version : 'UNKNOWN';
    var state = {
      version: version,
      stats: serializeStatsObject(stats)
    };
    var scene = stats.scene;
    if (scene && typeof scene === 'object') {
      state.temps = deepClone(scene.temps || {});
      state.lineNum = typeof scene.lineNum === 'number' ? scene.lineNum : 0;
      state.indent = typeof scene.indent === 'number' ? scene.indent : 0;
      state.stats._idoll_checkpoint = getCurrentLabel(scene);
    } else {
      state.temps = {};
      state.lineNum = 0;
      state.indent = 0;
    }
    var idx = getCurrentSceneIndex();
    if (idx !== null) state.currentSceneIndex = idx;
    state.pastLines = (window.nav && Array.isArray(window.nav.pastLines)) ? deepClone(window.nav.pastLines) : [];
    state.recentChecks = (window.nav && window.nav.recentChecks && typeof window.nav.recentChecks === 'object') ? deepClone(window.nav.recentChecks) : {};
    return state.stats && state.stats.sceneName ? state : null;
  }

  function deepMerge(base, override) {
    if (override === null || typeof override !== 'object') return override;
    if (Array.isArray(override)) return deepClone(override);
    var result = {};
    var k;
    for (k in base) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) continue;
      if (k === 'scene') continue;
      result[k] = (override !== null && typeof override === 'object' && Object.prototype.hasOwnProperty.call(override, k))
        ? deepMerge(base[k], override[k])
        : deepClone(base[k]);
    }
    for (k in override) {
      if (k === 'scene') continue;
      if (Object.prototype.hasOwnProperty.call(override, k) && !Object.prototype.hasOwnProperty.call(result, k))
        result[k] = deepClone(override[k]);
    }
    return result;
  }

  function renderScene(state) {
    if (!state || !state.stats || typeof state.stats !== 'object') return false;
    var clearScreen = window.clearScreen;
    var restoreGame = window.restoreGame;
    if (typeof clearScreen !== 'function' || typeof restoreGame !== 'function') return false;
    var idx = state.currentSceneIndex;
    if (typeof idx === 'number' && window.nav && window.nav._sceneList && idx >= 0 && idx < window.nav._sceneList.length)
      state.stats.sceneName = window.nav._sceneList[idx];
    if (!state.stats.sceneName) return false;
    var currentStats = getStats();
    if (currentStats && state.stats) state.stats = deepMerge(currentStats, state.stats);
    state.temps = (state.temps && typeof state.temps === 'object') ? deepClone(state.temps) : {};
    state.temps.choice_reuse = 'allow';
    state.temps.choice_user_restored = true;
    state.lineNum = 0;
    state.indent = 0;
    if (!state.stats._idoll_checkpoint) state.stats._idoll_checkpoint = '';
    clearScreen(function () {
      restoreGame(state, null, true);
    });
    return true;
  }

  function writeSave(state) {
    if (!state || !state.stats || !state.stats.sceneName) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function save(callback) {
    var state = getFullState();
    if (typeof callback === 'function') {
      callback(state ? writeSave(state) : false);
      return undefined;
    }
    return state ? writeSave(state) : false;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null || raw === '') return false;
      var state = JSON.parse(raw);
      if (!state || typeof state !== 'object') return false;
      if (state.stats && typeof state.stats === 'object' && (state.currentSceneIndex != null || state.stats.sceneName)) {
        renderScene(state);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function exportStateToFile(state) {
    if (!state) return false;
    try {
      var str = JSON.stringify(state, null, 2);
      if (!str) return false;
      var blob = new Blob([str], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = EXPORT_FILENAME;
      a.setAttribute('download', EXPORT_FILENAME);
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 300);
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportToFile(callback) {
    var state = getFullState();
    var currentSceneIndex = getCurrentSceneIndex();
    if (currentSceneIndex != null && state) state.currentSceneIndex = currentSceneIndex;
    console.log('Exporting index:', currentSceneIndex, 'checkpoint:', state && state.stats ? state.stats._idoll_checkpoint : '');
    if (typeof callback === 'function') {
      callback(state ? exportStateToFile(state) : false);
      return undefined;
    }
    return exportStateToFile(state);
  }

  function importFromJSON(jsonString) {
    try {
      if (typeof jsonString !== 'string' || !jsonString.trim()) return false;
      jsonString = jsonString.replace(/^\uFEFF/, '');
      var state = JSON.parse(jsonString);
      if (!state || typeof state !== 'object') return false;
      if (state.stats && typeof state.stats === 'object' && (state.currentSceneIndex != null || state.stats.sceneName)) {
        renderScene(state);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function importFromFileInput(callback) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,text/plain';
    input.style.display = 'none';
    function done(ok, reason) {
      try { document.body.removeChild(input); } catch (e) {}
      if (callback) callback(ok, reason);
    }
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) { done(false, 'cancelled'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var json = reader.result;
        if (json == null) { done(false, 'empty'); return; }
        if (typeof json !== 'string') json = String(json);
        done(importFromJSON(json), null);
      };
      reader.onerror = function () { done(false, 'read_error'); };
      reader.readAsText(file, 'UTF-8');
    };
    document.body.appendChild(input);
    input.click();
  }

  window.IdollSave = {
    save: save,
    load: load,
    exportToFile: exportToFile,
    importFromJSON: importFromJSON,
    importFromFileInput: importFromFileInput,
    renderScene: renderScene,
    getCurrentSceneIndex: getCurrentSceneIndex,
    getFullState: getFullState,
    STORAGE_KEY: STORAGE_KEY
  };

  function injectUI() {
    if (document.getElementById('idoll-save-ui')) return;
    var wrap = document.createElement('div');
    wrap.id = 'idoll-save-ui';
    wrap.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;display:flex;flex-direction:column;gap:6px;font-family:sans-serif;font-size:13px;';
    var btnStyle = 'padding:8px 12px;cursor:pointer;border:1px solid #555;border-radius:6px;background:#333;color:#eee;';
    [ { key: 'save', label: 'Save (localStorage)' }, { key: 'load', label: 'Load (resume)' }, { key: 'export', label: 'Export (JSON)' }, { key: 'import', label: 'Import (JSON)' } ].forEach(function (item) {
      var btn = document.createElement('button');
      btn.textContent = item.label;
      btn.style.cssText = btnStyle;
      btn.onclick = function () {
        try {
          if (item.key === 'save') {
            IdollSave.save(function (ok) {
              if (ok) alert('Saved!');
              else alert('Error: Start the game, then Save.');
            });
          } else if (item.key === 'load') {
            if (IdollSave.load()) alert('Load complete. Restoring to saved position...');
            else alert('No saved data.');
          } else if (item.key === 'export') {
            IdollSave.exportToFile(function (ok) {
              if (ok) alert('Export complete. Use Import to restore.');
              else alert('Export failed.');
            });
          } else if (item.key === 'import') {
            IdollSave.importFromFileInput(function (ok) {
              if (ok) alert('Import complete. You are at the saved position.');
              else alert('Import failed.');
            });
          }
        } catch (err) { alert('Error: ' + (err && err.message ? err.message : String(err))); }
      };
      wrap.appendChild(btn);
    });
    document.body.appendChild(wrap);
  }

  if (document.body) {
    setTimeout(injectUI, 200);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(injectUI, 200); });
  }
})();
