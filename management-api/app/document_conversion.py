"""LibreOffice headless 文档格式转换实现。"""

from __future__ import annotations

import os
import signal
import subprocess
import uuid
import zipfile
from pathlib import Path

from .config import DOCUMENT_CONVERSION_TIMEOUT_SECONDS


ALLOWED_FORMATS = {"doc", "docx", "ppt", "pptx", "pdf"}
OFFICE_TO_PDF = {"doc": "writer_pdf_Export", "docx": "writer_pdf_Export", "ppt": "impress_pdf_Export", "pptx": "impress_pdf_Export"}
PDF_TO_OFFICE = {"doc": "doc:MS Word 97", "docx": "docx:MS Word 2007 XML", "ppt": "ppt:MS PowerPoint 97", "pptx": "pptx:Impress MS PowerPoint 2007 XML"}


def convert_document(source: Path, target_format: str, output_dir: Path) -> Path:
    source_format = source.suffix.lower().lstrip(".")
    target_format = target_format.lower().lstrip(".")
    if source_format not in ALLOWED_FORMATS or target_format not in ALLOWED_FORMATS:
        raise ValueError("不支持的文档格式")
    if source_format == target_format:
        raise ValueError("源文件格式与目标格式相同")
    if target_format != "pdf" and source_format != "pdf":
        raise ValueError("当前仅支持 Office 文档与 PDF 之间转换")

    output_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = output_dir / f".lo-profile-{uuid.uuid4().hex}"
    profile_dir.mkdir()
    if target_format == "pdf":
        export_filter = OFFICE_TO_PDF[source_format]
        convert_to = f"pdf:{export_filter}"
    else:
        convert_to = PDF_TO_OFFICE[target_format]
    command = [
        "soffice",
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        "--norestore",
        f"-env:UserInstallation={profile_dir.as_uri()}",
        "--convert-to",
        convert_to,
        "--outdir",
        str(output_dir),
        str(source),
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        process.communicate(timeout=DOCUMENT_CONVERSION_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as error:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise TimeoutError("文档转换超时，请尝试较小的文件") from error
    finally:
        # LibreOffice may retain profile files briefly; keep cleanup best-effort.
        import shutil

        shutil.rmtree(profile_dir, ignore_errors=True)

    output_path = output_dir / f"{source.stem}.{target_format}"
    if process.returncode != 0 or not output_path.is_file():
        raise RuntimeError("转换失败，请检查文件是否损坏或格式是否受支持")
    return output_path
