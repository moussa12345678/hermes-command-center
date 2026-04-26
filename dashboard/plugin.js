/**
 * Hermes Command Center - Frontend Plugin
 * Wraps the mission-control UI in a React component for the Hermes Dashboard.
 */
(function () {
  'use strict';

  const PLUGIN_ID = 'hermes-command-center';
  const API_BASE = '/api/plugins/command-center';
  const POLL_INTERVAL = 5000;

  // Access Hermes SDK
  const SDK = window.__HERMES_PLUGIN_SDK__;
  const { React } = SDK;
  const { useEffect, useRef } = SDK.hooks;

  // ───────────────────────────────────────────────────────────────────────
  // Core UI class (unchanged logic, receives a container DOM element)
  // ───────────────────────────────────────────────────────────────────────
  class CommandCenter {
    constructor(container) {
      this.container = container;
      this.chart = null;
      this.chartData = { labels: [], cpu: [], mem: [] };
      this.pollTimers = [];
      this.init();
      window[PLUGIN_ID] = this;
    }

    // (جميع الدوال الداخلية كما هي من الإصدار السابق، لم يتم تغييرها)
    async init() {
      this.injectStyles();
      await this.loadChartJS();
      this.render();
      this.startPolling();
      this.setupEventListeners();
    }

    injectStyles() {
      const style = document.createElement('style');
      style.textContent = `
        :root {
          --cc-bg: var(--hermes-bg-primary, #0f1117);
          --cc-panel: var(--hermes-bg-secondary, #161b22);
          --cc-border: var(--hermes-border, #30363d);
          --cc-text: var(--hermes-text-primary, #c9d1d9);
          --cc-text-muted: var(--hermes-text-secondary, #8b949e);
          --cc-accent: var(--hermes-accent, #58a6ff);
          --cc-success: #3fb950;
          --cc-warning: #d29922;
          --cc-danger: #f85149;
          --cc-font: var(--hermes-font-mono, 'SF Mono', Monaco, Consolas, monospace);
        }
        .cc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
        .cc-card { background: var(--cc-panel); border: 1px solid var(--cc-border); border-radius: 8px; padding: 1rem; }
        .cc-card h3 { margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--cc-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .cc-metric { font-size: 1.8rem; font-weight: 600; color: var(--cc-text); }
        .cc-sub { font-size: 0.8rem; color: var(--cc-text-muted); margin-top: 0.25rem; }
        .cc-panel { background: var(--cc-panel); border: 1px solid var(--cc-border); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
        .cc-panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--cc-border); padding-bottom: 0.5rem; }
        .cc-panel-title { font-size: 1rem; font-weight: 600; color: var(--cc-text); margin: 0; }
        table.cc-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        table.cc-table th, table.cc-table td { text-align: left; padding: 0.75rem; border-bottom: 1px solid var(--cc-border); color: var(--cc-text); }
        table.cc-table th { color: var(--cc-text-muted); font-weight: 500; }
        .cc-status { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
        .cc-status.running { background: rgba(88,166,255,0.15); color: var(--cc-accent); }
        .cc-status.queued { background: rgba(210,153,34,0.15); color: var(--cc-warning); }
        .cc-btn { background: var(--cc-accent); color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
        .cc-btn:hover { opacity: 0.9; }
        .cc-btn.danger { background: var(--cc-danger); }
        .cc-terminal { background: #0d1117; border: 1px solid var(--cc-border); border-radius: 6px; padding: 0.75rem; font-family: var(--cc-font); font-size: 0.85rem; height: 250px; overflow-y: auto; display: flex; flex-direction: column; }
        .cc-log { flex: 1; overflow-y: auto; margin-bottom: 0.5rem; white-space: pre-wrap; color: var(--cc-text); }
        .cc-log .cmd { color: var(--cc-accent); }
        .cc-log .res { color: var(--cc-success); }
        .cc-log .err { color: var(--cc-danger); }
        .cc-input-row { display: flex; gap: 0.5rem; }
        .cc-input { flex: 1; background: #161b22; border: 1px solid var(--cc-border); color: var(--cc-text); padding: 0.5rem; border-radius: 4px; font-family: var(--cc-font); }
        .cc-input:focus { outline: none; border-color: var(--cc-accent); }
        .cc-notif-item { padding: 0.5rem 0; border-bottom: 1px solid var(--cc-border); display: flex; gap: 0.75rem; align-items: flex-start; }
        .cc-notif-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
        .cc-notif-dot.info { background: var(--cc-accent); }
        .cc-notif-dot.success { background: var(--cc-success); }
        .cc-notif-dot.warning { background: var(--cc-warning); }
        .cc-notif-dot.error { background: var(--cc-danger); }
        .cc-notif-msg { font-size: 0.85rem; color: var(--cc-text); }
        .cc-notif-time { font-size: 0.75rem; color: var(--cc-text-muted); margin-top: 0.2rem; }
        @media (max-width: 768px) { .cc-grid { grid-template-columns: 1fr; } }
      `;
      document.head.appendChild(style);
    }

    loadChartJS() {
      return new Promise((resolve) => {
        if (window.Chart) return resolve();
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }

    render() {
      this.container.innerHTML = `
        <div class="cc-grid">
          <div class="cc-card" id="cc-cpu"><h3>CPU Usage</h3><div class="cc-metric">--%</div><div class="cc-sub">Real-time</div></div>
          <div class="cc-card" id="cc-mem"><h3>Memory</h3><div class="cc-metric">--%</div><div class="cc-sub">-- / -- GB</div></div>
          <div class="cc-card" id="cc-disk"><h3>Disk</h3><div class="cc-metric">--%</div><div class="cc-sub">Root volume</div></div>
          <div class="cc-card" id="cc-sess"><h3>Active Sessions</h3><div class="cc-metric">--</div><div class="cc-sub">Connected clients</div></div>
          <div class="cc-card" id="cc-up"><h3>Uptime</h3><div class="cc-metric">--</div><div class="cc-sub">Since plugin load</div></div>
        </div>

        <div class="cc-panel">
          <div class="cc-panel-header"><h2 class="cc-panel-title">Resource Monitor (5m)</h2></div>
          <canvas id="cc-chart" height="100"></canvas>
        </div>

        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem;">
          <div>
            <div class="cc-panel">
              <div class="cc-panel-header"><h2 class="cc-panel-title">Active Tasks</h2></div>
              <table class="cc-table">
                <thead><tr><th>ID</th><th>Description</th><th>Status</th><th>Progress</th><th>Action</th></tr></thead>
                <tbody id="cc-tasks-body"><tr><td colspan="5" style="text-align:center; color:var(--cc-text-muted)">Loading...</td></tr></tbody>
              </table>
            </div>
            <div class="cc-panel">
              <div class="cc-panel-header"><h2 class="cc-panel-title">Live Steer Terminal</h2></div>
              <div class="cc-terminal">
                <div class="cc-log" id="cc-log">Welcome to Hermes Command Center. Type a command and press Enter.\n</div>
                <div class="cc-input-row">
                  <input type="text" class="cc-input" id="cc-cmd-input" placeholder="> enter agent command..." autocomplete="off">
                  <button class="cc-btn" id="cc-send-btn">Send</button>
                </div>
              </div>
            </div>
          </div>
          <div>
            <div class="cc-panel" style="height: 100%;">
              <div class="cc-panel-header"><h2 class="cc-panel-title">Notification Feed</h2></div>
              <div id="cc-notifs"></div>
            </div>
          </div>
        </div>
      `;
      this.setupChart();
    }

    setupChart() {
      const ctx = document.getElementById('cc-chart').getContext('2d');
      this.chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: this.chartData.labels,
          datasets: [
            { label: 'CPU %', data: this.chartData.cpu, borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.1)', tension: 0.4, fill: true },
            { label: 'MEM %', data: this.chartData.mem, borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,0.1)', tension: 0.4, fill: true }
          ]
        },
        options: {
          responsive: true,
          animation: false,
          scales: {
            x: { display: false },
            y: { min: 0, max: 100, grid: { color: '#30363d' }, ticks: { color: '#8b949e' } }
          },
          plugins: { legend: { labels: { color: '#c9d1d9' } } }
        }
      });
    }

    async fetchJSON(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.warn(`[CommandCenter] Fetch failed: ${url}`, err);
        return null;
      }
    }

    startPolling() {
      const poll = async () => {
        const stats = await this.fetchJSON(`${API_BASE}/system-stats`);
        if (stats) this.updateStats(stats);

        const tasks = await this.fetchJSON(`${API_BASE}/active-tasks`);
        if (tasks) this.updateTasks(tasks);

        const notifs = await this.fetchJSON(`${API_BASE}/notifications`);
        if (notifs) this.updateNotifications(notifs);
      };

      poll();
      const timer = setInterval(poll, POLL_INTERVAL);
      this.pollTimers.push(timer);
    }

    updateStats(stats) {
      document.querySelector('#cc-cpu .cc-metric').textContent = `${stats.cpu_percent}%`;
      document.querySelector('#cc-mem .cc-metric').textContent = `${stats.memory_percent}%`;
      document.querySelector('#cc-mem .cc-sub').textContent = `${stats.memory_used_gb} / ${stats.memory_total_gb} GB`;
      document.querySelector('#cc-disk .cc-metric').textContent = `${stats.disk_percent}%`;
      document.querySelector('#cc-sess .cc-metric').textContent = stats.active_sessions_count;
      
      const hrs = Math.floor(stats.uptime_seconds / 3600);
      const mins = Math.floor((stats.uptime_seconds % 3600) / 60);
      document.querySelector('#cc-up .cc-metric').textContent = `${hrs}h ${mins}m`;

      const now = new Date().toLocaleTimeString();
      this.chartData.labels.push(now);
      this.chartData.cpu.push(stats.cpu_percent);
      this.chartData.mem.push(stats.memory_percent);
      if (this.chartData.labels.length > 30) {
        this.chartData.labels.shift();
        this.chartData.cpu.shift();
        this.chartData.mem.shift();
      }
      this.chart.update();
    }

    updateTasks(tasks) {
      const tbody = document.getElementById('cc-tasks-body');
      if (!tasks || !tasks.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--cc-text-muted)">No active tasks</td></tr>';
        return;
      }
      tbody.innerHTML = tasks.map(t => `
        <tr>
          <td style="font-family:var(--cc-font)">${t.id}</td>
          <td>${t.description}</td>
          <td><span class="cc-status ${t.status}">${t.status}</span></td>
          <td>${Math.round(t.progress * 100)}%</td>
          <td><button class="cc-btn danger" onclick="window['${PLUGIN_ID}'].cancelTask('${t.id}')">Cancel</button></td>
        </tr>
      `).join('');
    }

    updateNotifications(notifs) {
      const container = document.getElementById('cc-notifs');
      container.innerHTML = notifs.map(n => `
        <div class="cc-notif-item">
          <div class="cc-notif-dot ${n.type}"></div>
          <div>
            <div class="cc-notif-msg">${n.message}</div>
            <div class="cc-notif-time">${new Date(n.timestamp).toLocaleTimeString()}</div>
          </div>
        </div>
      `).join('');
    }

    setupEventListeners() {
      const input = document.getElementById('cc-cmd-input');
      const btn = document.getElementById('cc-send-btn');
      
      const send = async () => {
        const cmd = input.value.trim();
        if (!cmd) return;
        input.value = '';
        this.log(`> ${cmd}`, 'cmd');
        
        try {
          const res = await fetch(`${API_BASE}/steer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmd })
          });
          const data = await res.json();
          if (res.ok) this.log(data.response, 'res');
          else this.log(`Error: ${data.detail || res.statusText}`, 'err');
        } catch (e) {
          this.log(`Network error: ${e.message}`, 'err');
        }
      };

      btn.addEventListener('click', send);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    }

    log(msg, type = '') {
      const logEl = document.getElementById('cc-log');
      const line = document.createElement('div');
      line.className = type;
      line.textContent = msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }

    cancelTask(taskId) {
      if (confirm(`Cancel task ${taskId}?`)) {
        this.log(`[SYSTEM] Cancel requested for ${taskId}. (Implement POST /tasks/${taskId}/cancel in backend)`, 'warn');
      }
    }

    destroy() {
      this.pollTimers.forEach(clearInterval);
      if (this.chart) this.chart.destroy();
      delete window[PLUGIN_ID];
    }
  }

  // ── React Wrapper Component ──
  function CommandCenterPage() {
    const containerRef = useRef(null);

    useEffect(() => {
      let instance;
      if (containerRef.current) {
        instance = new CommandCenter(containerRef.current);
      }
      return () => {
        if (instance) instance.destroy();
      };
    }, []);

    return React.createElement('div', { ref: containerRef, style: { minHeight: '400px' } });
  }

  // Register with the Hermes Dashboard
  window.__HERMES_PLUGINS__.register(PLUGIN_ID, CommandCenterPage);
})();
