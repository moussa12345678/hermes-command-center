# 🛰️ Hermes Command Center

A comprehensive mission-control interface for real-time agent orchestration, live task steering, and system overview. Built as a drop-in plugin for the **Hermes Agent Dashboard**.

![screenshot](assets/screenshot.png)

## Features
- Real-time CPU, Memory, Disk, Uptime, Active Sessions (via `hermes_state.SessionDB`)
- Live resource chart (Chart.js)
- Active tasks table from `hermes_state.TaskDB`
- Live steer terminal (connects to `hermes_core.runtime` or CLI)
- Notification feed from `EventLog` or `agent.log`
- Dark theme, responsive, zero mock data

## Installation
```bash
mkdir -p ~/.hermes/plugins/hermes-command-center/dashboard
git clone https://github.com/moussa12345678/hermes-command-center.git
cp -r hermes-command-center/dashboard/* ~/.hermes/plugins/hermes-command-center/dashboard/
pip install psutil fastapi pydantic
hermes dashboard restart
hermes-command-center/
├── dashboard/
│   ├── manifest.json
│   ├── plugin.js
│   ├── plugin.py
│   └── README.md
└── README.md (this file)
