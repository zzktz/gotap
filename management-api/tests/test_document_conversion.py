import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import os

os.environ.setdefault("JWT_SECRET", "test-secret-that-is-at-least-32-characters")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.document_conversion import convert_document  # noqa: E402


class DocumentConversionTests(unittest.TestCase):
    def test_rejects_unsupported_source_format_before_running_converter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "image.png"
            source.write_bytes(b"not a document")
            with self.assertRaisesRegex(ValueError, "不支持的文档格式"):
                convert_document(source, "pdf", Path(directory) / "out")

    def test_rejects_office_to_office_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.docx"
            source.write_bytes(b"PK\\x03\\x04")
            with self.assertRaisesRegex(ValueError, "Office 文档与 PDF"):
                convert_document(source, "pptx", Path(directory) / "out")

    @patch("app.document_conversion.subprocess.Popen")
    def test_office_to_pdf_uses_headless_writer_filter(self, popen: Mock) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.docx"
            source.write_bytes(b"document")
            output_dir = Path(directory) / "out"
            output_dir.mkdir()
            (output_dir / "sample.pdf").write_bytes(b"%PDF-result")
            process = Mock(returncode=0)
            process.communicate.return_value = ("", "")
            popen.return_value = process

            result = convert_document(source, "pdf", output_dir)

            self.assertEqual(result.name, "sample.pdf")
            command = popen.call_args.args[0]
            self.assertIn("pdf:writer_pdf_Export", command)
            self.assertIn("--headless", command)

    @patch("app.document_conversion.subprocess.Popen")
    def test_pdf_to_docx_uses_writer_export_filter(self, popen: Mock) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.pdf"
            source.write_bytes(b"%PDF-sample")
            output_dir = Path(directory) / "out"
            output_dir.mkdir()
            (output_dir / "sample.docx").write_bytes(b"PK-result")
            process = Mock(returncode=0)
            process.communicate.return_value = ("", "")
            popen.return_value = process

            result = convert_document(source, "docx", output_dir)

            self.assertEqual(result.name, "sample.docx")
            command = popen.call_args.args[0]
            self.assertIn("docx:Office Open XML Text", command)
            self.assertIn("--headless", command)

    @patch("app.document_conversion.subprocess.Popen")
    def test_missing_output_is_reported_as_conversion_failure(self, popen: Mock) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sample.pptx"
            source.write_bytes(b"document")
            process = Mock(returncode=0)
            process.communicate.return_value = ("", "")
            popen.return_value = process

            with self.assertRaisesRegex(RuntimeError, "转换失败"):
                convert_document(source, "pdf", Path(directory) / "out")


if __name__ == "__main__":
    unittest.main()
