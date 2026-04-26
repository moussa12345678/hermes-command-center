"""
Hermes Command Center - Backend Plugin
FastAPI router mounted automatically at /api/plugins/command-center/
Connects to live Hermes internals with graceful fallbacks for version compatibility.
"""
import logging
import time
import os
from datetime import datetime, timezone
from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psutil

logger = logging.getLogger("hermes.plugins.command_center")
router = APIRouter()
PLUGIN_BOOT_TIME = time.time()

_HAS_SESSION_DB = False
_HAS_TASK_DB = False
_HAS_EVENT_LOG = False
_HAS_AGENT_RUNTIME = False
_USE_CLI_STEER = False

try:
    from hermes_state import SessionDB
    _HAS_SESSION_DB = True
except ImportError:
    logger.warning("hermes_state.SessionDB not found. Session count will fallback to 0.")

try:
    from hermes_state import TaskDB
    _HAS_TASK_DB = True
except ImportError:
    logger.warning("hermes_state.TaskDB not found. Active tasks endpoint will return graceful error.")

try:
    from hermes_state import EventLog
    _HAS_EVENT_LOG = True
except ImportError:
    logger.warning("hermes_state.EventLog not found. Notifications will fallback to log parsing.")

try:
    from hermes_core.runtime import AgentRuntime
    _HAS_AGENT_RUNTIME = True
except ImportError:
    try:
        from hermes_cli.agent import send_command
        _HAS_AGENT_RUNTIME = True
        _USE_CLI_STEER = True
    except ImportError:
        logger.warning("Agent steering interface not found. /steer will return 501 with instructions.")

class SteerRequest(BaseModel):
    command: str

def get_hermes_dir() -> str:
    return os.environ.get("HERMES_DIR", os.path.expanduser("~/.hermes"))

@router.get("/system-stats")
async def get_system_stats():
    try:
        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        uptime = time.time() - PLUGIN_BOOT_TIME
        active_sessions = 0
        if _HAS_SESSION_DB:
            db = SessionDB()
            try:
                sessions = db.list_sessions(limit=9999)
                active_sessions = sum(1 for s in sessions if getattr(s, 'status', s.get('status')) == 'active')
            finally:
                db.close()
        return {
            "cpu_percent": cpu,
            "memory_percent": mem.percent,
            "memory_used_gb": round(mem.used / (1024**3), 2),
            "memory_total_gb": round(mem.total / (1024**3), 2),
            "disk_percent": disk.percent,
            "uptime_seconds": uptime,
            "active_sessions_count": active_sessions
        }
    except Exception as e:
        logger.error(f"System stats error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/active-tasks")
async def get_active_tasks():
    if not _HAS_TASK_DB:
        raise HTTPException(status_code=503, detail="TaskDB not available. Check your Hermes installation.")
    try:
        db = TaskDB()
        try:
            tasks = db.list_tasks(statuses=["running", "queued"], limit=50)
            result = []
            for t in tasks:
                tid = getattr(t, 'id', t.get('id'))
                desc = getattr(t, 'description', t.get('description', getattr(t, 'prompt', t.get('prompt', 'Unknown task'))))
                created = getattr(t, 'created_at', t.get('created_at'))
                status = getattr(t, 'status', t.get('status'))
                progress = getattr(t, 'progress', t.get('progress', 0.0))
                if isinstance(created, datetime):
                    created_str = created.isoformat()
                elif isinstance(created, str):
                    created_str = created
                else:
                    created_str = datetime.now(timezone.utc).isoformat()
                result.append({
                    "id": str(tid),
                    "description": str(desc)[:120],
                    "created_at": created_str,
                    "status": str(status).lower(),
                    "progress": float(progress)
                })
            return result
        finally:
            db.close()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Active tasks error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/notifications")
async def get_notifications():
    try:
        events = []
        if _HAS_EVENT_LOG:
            log = EventLog()
            try:
                raw_events = log.recent(limit=15)
                type_map = {"debug": "info", "info": "info", "warn": "warning", "warning": "warning",
                            "error": "error", "critical": "error", "success": "success"}
                for e in raw_events:
                    level = getattr(e, 'level', e.get('level', 'info')).lower()
                    events.append({
                        "id": str(getattr(e, 'id', e.get('id', ''))),
                        "type": type_map.get(level, "info"),
                        "message": str(getattr(e, 'message', e.get('message', '')))[:200],
                        "timestamp": str(getattr(e, 'timestamp', e.get('timestamp', datetime.now(timezone.utc).isoformat())))
                    })
            finally:
                log.close()
        else:
            log_path = os.path.join(get_hermes_dir(), "logs", "agent.log")
            if os.path.exists(log_path):
                with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()[-15:]
                for i, line in enumerate(lines):
                    line = line.strip()
                    if not line: continue
                    l_lower = line.lower()
                    n_type = "error" if "error" in l_lower or "traceback" in l_lower else \
                             "warning" if "warn" in l_lower else "info"
                    events.append({
                        "id": f"log_{i}",
                        "type": n_type,
                        "message": line[:200],
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
            else:
                events.append({"id": "sys_1", "type": "info", "message": "Event log not found.", "timestamp": str(datetime.now(timezone.utc))})
        return sorted(events, key=lambda x: x["timestamp"], reverse=True)[:15]
    except Exception as e:
        logger.error(f"Notifications error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/steer")
async def steer_agent(payload: SteerRequest):
    cmd = payload.command.strip()
    if not cmd:
        raise HTTPException(status_code=400, detail="Command cannot be empty")
    if not _HAS_AGENT_RUNTIME:
        raise HTTPException(status_code=501, detail="Steering interface not available. Try: hermes steer '<command>'")
    try:
        if _USE_CLI_STEER:
            from hermes_cli.agent import send_command
            result = send_command(cmd, timeout=10)
            response_text = result.get("output", result.get("message", "Command queued."))
        else:
            runtime = AgentRuntime.get_instance()
            ack = runtime.inject_command(cmd, source="dashboard_plugin")
            response_text = getattr(ack, 'message', ack.get('message', 'Command acknowledged.'))
        return {"status": "success", "response": str(response_text), "timestamp": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        logger.error(f"Steer error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
