"""数据库备份、清理和后台维护任务。"""

import logging
import shutil
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import (
    DB_BACKUP_DIR,
    DB_BACKUP_INTERVAL_SECONDS,
    DB_BACKUP_RETENTION_DAYS,
    DB_BUSY_TIMEOUT_MS,
    DB_PATH,
    USAGE_REPORT_RETENTION_DAYS,
)

logger = logging.getLogger(__name__)
_stop_event = threading.Event()
_worker: threading.Thread | None = None


def _backup_files() -> list[Path]:
    if not DB_BACKUP_DIR.exists():
        return []
    files: list[tuple[float, Path]] = []
    for path in DB_BACKUP_DIR.glob(f"{DB_PATH.name}.backup-*.sqlite3"):
        try:
            files.append((path.stat().st_mtime, path))
        except OSError:
            continue
    return [path for _, path in sorted(files, reverse=True)]


def _prune_old_backups() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=DB_BACKUP_RETENTION_DAYS)
    for path in _backup_files():
        try:
            modified_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            if modified_at < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            logger.warning("无法清理旧数据库备份：%s", path, exc_info=True)


def online_database_backup() -> Path:
    """创建一致的在线数据库备份，不直接复制正在写入的数据库文件。"""
    DB_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = DB_BACKUP_DIR / f"{DB_PATH.name}.backup-{stamp}.sqlite3"
    temporary = DB_BACKUP_DIR / f".{destination.name}.tmp"
    source_connection = sqlite3.connect(DB_PATH, timeout=DB_BUSY_TIMEOUT_MS / 1000)
    backup_connection = sqlite3.connect(temporary)
    try:
        source_connection.execute(f"PRAGMA busy_timeout = {DB_BUSY_TIMEOUT_MS}")
        source_connection.backup(backup_connection, pages=1000, sleep=0.05)
        backup_connection.commit()
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    finally:
        backup_connection.close()
        source_connection.close()
    temporary.replace(destination)
    _prune_old_backups()
    return destination


def database_maintenance_once() -> None:
    """执行一次流量、版本和数据库备份维护。"""
    # 延迟导入避免维护模块与应用模块在启动时形成循环导入。
    from . import main as application

    cutoff = application.iso(application.now() - timedelta(days=USAGE_REPORT_RETENTION_DAYS))
    with application.db() as connection:
        deleted = connection.execute(
            "DELETE FROM usage_reports WHERE reported_at < ?", (cutoff,)
        ).rowcount
        release_cleanup = application._prune_old_releases(connection)
        connection.execute("PRAGMA optimize")
    application._remove_release_files(release_cleanup)
    backup = online_database_backup()
    logger.info(
        "数据库维护完成：清理 %s 条流量明细、%s 个旧版本，在线备份 %s",
        max(deleted, 0),
        len(release_cleanup),
        backup,
    )


def _maintenance_loop() -> None:
    while not _stop_event.is_set():
        try:
            database_maintenance_once()
        except Exception:
            logger.exception("数据库维护失败")
        if _stop_event.wait(DB_BACKUP_INTERVAL_SECONDS):
            break


def latest_database_backup() -> dict[str, object] | None:
    backups = _backup_files()
    if not backups:
        return None
    path = backups[0]
    try:
        stat = path.stat()
    except OSError:
        return None
    return {
        "filename": path.name,
        "size_bytes": stat.st_size,
        "created_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def start() -> None:
    """启动数据库后台维护线程。"""
    global _worker
    _stop_event.clear()
    _worker = threading.Thread(target=_maintenance_loop, name="database-maintenance", daemon=True)
    _worker.start()


def stop() -> None:
    """停止数据库后台维护线程。"""
    _stop_event.set()
    if _worker and _worker.is_alive():
        _worker.join(timeout=5)
