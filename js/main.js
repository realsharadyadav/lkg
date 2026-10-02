/* LKG — boot, sheets, syntax highlight, notes renderer, FX, settings, PWA */
(function () {
  const SS = window.SS;
  const $ = s => document.querySelector(s);
  SS.audioUnlocked = false;

  /* ---------------- toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------------- sheets ---------------- */
  const scrim = $('#scrim');
  const sheets = { code: $('#codePanel'), notes: $('#notesSheet'), settings: $('#settingsSheet') };
  let openName = null;
  function openSheet(name) {
    Object.values(sheets).forEach(s => s.classList.remove('open'));
    sheets[name].classList.add('open'); scrim.classList.add('on'); openName = name;
  }
  function closeSheets() { Object.values(sheets).forEach(s => s.classList.remove('open')); scrim.classList.remove('on'); openName = null; }
  scrim.addEventListener('click', closeSheets);
  document.querySelectorAll('.close-sheet').forEach(b => b.addEventListener('click', closeSheets));

  /* ---------------- python highlighting ---------------- */
  function py(code) {
    const esc = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const re = /(#[^\n]*)|("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(import|from|def|return|if|else|elif|while|for|in|not|and|or|is|None|True|False|class|with|as|try|except|finally|lambda|pass|raise|await|async|yield|global|print)\b|(@[\w.]+)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_]\w*)(?=\()/g;
    return esc.replace(re, (m, com, str, kw, dec, num, fn) => {
      if (com) return `<span class="c-c">${com}</span>`;
      if (str) return `<span class="c-s">${str}</span>`;
      if (kw) return `<span class="c-k">${kw}</span>`;
      if (dec) return `<span class="c-d">${dec}</span>`;
      if (num) return `<span class="c-n">${num}</span>`;
      if (fn) return `<span class="c-f">${fn}</span>`;
      return m;
    });
  }

  /* ---------------- mini markdown for notes ---------------- */
  function md(src) {
    const lines = src.trim().split('\n');
    let html = '', list = false, table = null;
    const para = [];
    const inline = s => s
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const flush = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para.length = 0; } };
    const closeList = () => { if (list) { html += '</ul>'; list = false; } };
    const flushTable = () => {
      if (!table) return;
      html += '<table class="ntb"><tr>' + table[0].map(c => `<th>${inline(c)}</th>`).join('') + '</tr>' +
        table.slice(1).map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>';
      table = null;
    };
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) { flush(); closeList(); flushTable(); continue; }
      if (line.startsWith('## ')) { flush(); closeList(); flushTable(); html += `<h4>${inline(line.slice(3))}</h4>`; }
      else if (line.startsWith('# ')) { flush(); closeList(); flushTable(); html += `<h3>${inline(line.slice(2))}</h3>`; }
      else if (line.startsWith('- ')) { flush(); flushTable(); if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(line.slice(2))}</li>`; }
      else if (line.startsWith('> ')) { flush(); closeList(); flushTable(); html += `<div class="nb">${inline(line.slice(2))}</div>`; }
      else if (line.startsWith('|') && line.endsWith('|')) {
        flush(); closeList();
        const cells = line.slice(1, -1).split('|').map(c => c.trim());
        if (cells.every(c => /^:?-+:?$/.test(c))) continue;
        (table = table || []).push(cells);
      }
      else { flushTable(); closeList(); para.push(line.trim()); }
    }
    flush(); closeList(); flushTable();
    return html;
  }

  /* ---------------- FX ---------------- */
  function heart(x, y) {
    const e = document.createElement('div');
    e.className = 'fx-heart'; e.textContent = '❤️';
    e.style.left = x + 'px'; e.style.top = y + 'px';
    document.body.appendChild(e);
    e.animate([
      { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: .35 },
      { transform: 'translate(-50%,-110%) scale(1)', opacity: 0 }
    ], { duration: 900, easing: 'ease-out' }).onfinish = () => e.remove();
  }
  function confetti(container) {
    const r = container.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = Math.min(r.top + 120, innerHeight * .6);
    const colors = ['#a78bfa', '#34d399', '#ffd43b', '#fb7185', '#60a5fa', '#fb923c'];
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('div');
      p.className = 'fx-p';
      const sz = 5 + Math.random() * 6;
      p.style.cssText = `left:${cx}px;top:${cy}px;width:${sz}px;height:${sz}px;background:${colors[i % colors.length]}`;
      document.body.appendChild(p);
      const ang = Math.random() * Math.PI * 2, v = 90 + Math.random() * 190;
      p.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${Math.cos(ang) * v}px,${Math.sin(ang) * v + 130}px) rotate(${360 + Math.random() * 360}deg)`, opacity: 0 }
      ], { duration: 850 + Math.random() * 550, easing: 'cubic-bezier(.15,.6,.4,1)' }).onfinish = () => p.remove();
    }
  }

  SS.ui = {
    toast, openSheet, closeSheets,
    openCode(data) {
      if (!data.code) return;
      $('#codeTitle').textContent = data.code.title;
      $('#codeBody').innerHTML = py(data.code.body);
      $('#codeNotes').innerHTML = (data.code.annot || []).map(a => `<div>💡 ${a}</div>`).join('');
      openSheet('code');
    },
    openNotes(data) {
      if (!data.notes) return;
      $('#notesTitle').textContent = `📄 ${data.topic} — full notes`;
      $('#notesBody').innerHTML = md(data.notes);
      openSheet('notes');
    }
  };
  SS.fx = { heart, confetti };

  /* ---------------- settings ---------------- */
  function initSettings() {
    const sel = $('#voiceSel');
    const fill = () => {
      const vs = SS.narrator.voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
      sel.innerHTML = vs.map(v => {
        const mark = SS.narrator.isPremium(v) ? ' ✨' : '';
        const name = v.name.replace(/Microsoft |Google /, '');
        return `<option value="${v.voiceURI}">${name}${mark} — ${v.lang}</option>`;
      }).join('');
      if (SS.state.prefs.voiceURI) sel.value = SS.state.prefs.voiceURI;
    };
    fill();
    if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = fill;
    sel.addEventListener('change', () => { SS.narrator.setVoice(sel.value); toast('🗣️ Voice updated'); });

    $('#voiceTest').addEventListener('click', () => {
      const v = SS.narrator.voices.find(x => x.voiceURI === sel.value);
      if (v) SS.narrator.preview(v);
    });

    const rate = $('#rateSel'), rateVal = $('#rateVal');
    rate.value = SS.state.prefs.rate || 1.05;
    rateVal.textContent = (+rate.value).toFixed(2).replace(/0$/, '') + '×';
    rate.addEventListener('input', () => {
      SS.narrator.setRate(+rate.value);
      rateVal.textContent = (+rate.value).toFixed(2).replace(/0$/, '') + '×';
    });

    const mute = $('#muteSel');
    mute.checked = SS.narrator.muted;
    mute.addEventListener('change', () => { SS.narrator.setMuted(mute.checked); document.dispatchEvent(new CustomEvent('ss:mute')); });

    const expr = $('#exprSel'), exprVal = $('#exprVal');
    expr.value = SS.narrator.expr;
    exprVal.textContent = Math.round(SS.narrator.expr * 100) + '%';
    expr.addEventListener('input', () => {
      SS.narrator.setExpr(+expr.value);
      exprVal.textContent = Math.round(expr.value * 100) + '%';
    });

    $('#settingsBtn').addEventListener('click', () => openName === 'settings' ? closeSheets() : openSheet('settings'));
    $('#resetBtn').addEventListener('click', () => {
      if (confirm('Reset all progress, likes and streak on this device?')) { SS.state.reset(); location.reload(); }
    });
  }

  /* ---------------- audio unlock + boot ---------------- */
  function unlock() {
    if (SS.audioUnlocked) return;
    SS.audioUnlocked = true;
    SS.feed.kickActive();
  }
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  window.addEventListener('contextmenu', e => { if (!e.target.closest('.sheet')) e.preventDefault(); });

  function refreshStreak() { $('#streakCount').textContent = SS.state.streak(); }

  /* ---------------- PWA ---------------- */
  function initPwa() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    SS.loadCatalog().then(() => {
      SS.feed.init();
      initSettings();
      refreshStreak();
      initPwa();
      document.addEventListener('ss:complete', refreshStreak);
      setTimeout(() => toast('👋 Tap ▶ to start — then swipe up'), 700);
    }).catch(e => {
      toast('⚠️ Could not load course catalog — check connection');
      console.error(e);
    });
  });
})();
