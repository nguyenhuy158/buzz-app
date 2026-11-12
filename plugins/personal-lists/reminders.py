#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import time


def sync(state, value, now):
    if value == {"clear": True}:
        return {}
    viewer = value.get("viewer", "")
    community = value.get("community", "")
    tasks = value.get("tasks")
    if not re.fullmatch(r"[a-f0-9]{64}", viewer):
        raise ValueError("Invalid account")
    if not isinstance(community, str) or not community.startswith(("wss://", "https://")) or len(community) > 512:
        raise ValueError("Invalid community")
    if not isinstance(tasks, list) or len(tasks) > 1000:
        raise ValueError("Invalid tasks")
    if state.get("viewer") != viewer:
        state = {"viewer": viewer, "scopes": {}}
    scope = hashlib.sha256(community.encode()).hexdigest()
    previous = state["scopes"].get(scope, [])
    attempted = {task["key"] for task in previous if task.get("attempted")}
    pending = []
    for task in tasks:
        task_id, due = task.get("id", ""), task.get("due")
        if not isinstance(task_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", task_id):
            raise ValueError("Invalid task id")
        if type(due) is not int or not 0 <= due <= 253402300799:
            raise ValueError("Invalid reminder time")
        key = f"{task_id}:{due}"
        if due >= now - 86400:
            pending.append({"key": key, "due": due, "attempted": key in attempted})
    scopes = {**state["scopes"], scope: pending}
    if sum(len(tasks) for tasks in scopes.values()) > 1000:
        raise ValueError("Too many reminders. Clear old tasks first.")
    return {"viewer": viewer, "scopes": scopes}


def due_tasks(state, now):
    return [task for tasks in state.get("scopes", {}).values() for task in tasks
            if not task.get("attempted") and now - 86400 <= task["due"] <= now]


def run(mode, folder):
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (folder / "state.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = folder / "state.json"
        state = json.loads(path.read_text()) if path.exists() else {}
        now = int(time.time())
        notify = False
        if mode == "sync":
            value = sys.stdin.read(65537)
            if len(value.encode()) > 65536:
                raise ValueError("Request is too large")
            state = sync(state, json.loads(value), now)
        elif mode == "tick":
            tasks = due_tasks(state, now)
            notify = bool(tasks)
            for task in tasks:
                task["attempted"] = True
        else:
            raise ValueError("Unknown command")
        temporary = folder / "state.json.tmp"
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
            json.dump(state, output)
        temporary.replace(path)
        if notify:
            subprocess.run(["/usr/bin/osascript", "-e", 'display notification "Open Buzz Personal Lists to see your tasks." with title "To-do reminder"'], check=True, timeout=10, capture_output=True)
    if mode == "sync":
        print("ok")


def install(folder):
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    target = folder / "reminders.py"
    if Path(__file__).resolve() != target.resolve():
        shutil.copy2(__file__, target)
    binary = Path.home() / ".local/bin/buzz-personal-reminders"
    binary.parent.mkdir(parents=True, exist_ok=True)
    if binary.exists() and not binary.is_symlink():
        raise ValueError("The helper path is already used")
    if binary.is_symlink() and binary.resolve() != target.resolve():
        raise ValueError("The helper link is already used")
    target.chmod(0o700)
    if not binary.exists():
        binary.symlink_to(target)
    agent = Path.home() / "Library/LaunchAgents/personal.buzz.reminders.plist"
    agent.parent.mkdir(parents=True, exist_ok=True)
    config = {"Label": "personal.buzz.reminders", "ProgramArguments": [sys.executable, str(target), "tick"], "StartInterval": 30, "RunAtLoad": True}
    if agent.exists() and plistlib.loads(agent.read_bytes()) != config:
        raise ValueError("The launch agent path is already used")
    agent.write_bytes(plistlib.dumps(config))
    domain = f"gui/{os.getuid()}"
    if subprocess.run(["launchctl", "print", f"{domain}/personal.buzz.reminders"], capture_output=True).returncode:
        subprocess.run(["launchctl", "bootstrap", domain, str(agent)], check=True)
    print("Reminder helper installed")


if __name__ == "__main__":
    folder = Path.home() / "Library/Application Support/Buzz Personal Lists"
    try:
        mode = sys.argv[1]
        if mode == "install":
            install(folder)
        else:
            run(mode, folder)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
