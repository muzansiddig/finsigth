import asyncio
import io
import time
from typing import Literal

import pytesseract
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pdf2image import convert_from_bytes, pdfinfo_from_bytes
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from pytesseract import Output

MAX_DOCUMENT_BYTES = 12 * 1024 * 1024
MAX_PDF_PAGES = 20
MAX_IMAGE_PIXELS = 30_000_000
MAX_PROCESSING_SECONDS = 110
ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

app = FastAPI(title="FinSight local OCR", docs_url=None, redoc_url=None)
processing_slots = asyncio.Semaphore(1)


class Token(BaseModel):
    text: str
    confidence: float
    box: dict[str, int]


class Page(BaseModel):
    pageNumber: int
    text: str
    tokens: list[Token]


class OcrResult(BaseModel):
    provider: Literal["tesseract-local"]
    engineVersion: str
    languages: str
    pages: list[Page]
    text: str


def _check_signature(content: bytes, content_type: str) -> bool:
    if content_type == "application/pdf":
        return content.startswith(b"%PDF-")
    if content_type == "image/jpeg":
        return content.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    return (
        content_type == "image/webp"
        and content.startswith(b"RIFF")
        and content[8:12] == b"WEBP"
    )


def _page_result(image: Image.Image, page_number: int, deadline: float) -> Page:
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=413, detail="Page dimensions exceed the processing limit.")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("OCR processing time limit exceeded.")
    data = pytesseract.image_to_data(
        image,
        lang="eng+ara",
        output_type=Output.DICT,
        timeout=min(remaining, 45),
    )
    tokens: list[Token] = []
    lines: dict[tuple[int, int, int], list[str]] = {}
    for index, raw_text in enumerate(data["text"]):
        text = raw_text.strip()
        if not text:
            continue
        try:
            confidence = float(data["conf"][index])
        except (TypeError, ValueError):
            continue
        if confidence < 0:
            continue
        tokens.append(Token(
            text=text,
            confidence=round(confidence / 100, 4),
            box={
                "x": int(data["left"][index]),
                "y": int(data["top"][index]),
                "width": int(data["width"][index]),
                "height": int(data["height"][index]),
            },
        ))
        line_key = (
            int(data["block_num"][index]),
            int(data["par_num"][index]),
            int(data["line_num"][index]),
        )
        lines.setdefault(line_key, []).append(text)
    return Page(
        pageNumber=page_number,
        text="\n".join(" ".join(words) for words in lines.values()),
        tokens=tokens,
    )


def _process_document(content: bytes, content_type: str) -> OcrResult:
    deadline = time.monotonic() + MAX_PROCESSING_SECONDS
    pages: list[Page] = []
    try:
        if content_type == "application/pdf":
            info = pdfinfo_from_bytes(content, timeout=15)
            page_count = int(info.get("Pages", 0))
            if page_count < 1:
                raise HTTPException(status_code=422, detail="The PDF has no readable pages.")
            if page_count > MAX_PDF_PAGES:
                raise HTTPException(status_code=413, detail="PDFs are limited to 20 pages.")
            for page_number in range(1, page_count + 1):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("OCR processing time limit exceeded.")
                images = convert_from_bytes(
                    content,
                    dpi=180,
                    first_page=page_number,
                    last_page=page_number,
                    timeout=min(remaining, 30),
                )
                if not images:
                    raise HTTPException(status_code=422, detail="A PDF page could not be rendered.")
                pages.append(_page_result(images[0], page_number, deadline))
                images[0].close()
        else:
            with Image.open(io.BytesIO(content)) as source:
                if source.width * source.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(status_code=413, detail="Image dimensions exceed the processing limit.")
                image = ImageOps.exif_transpose(source).convert("RGB")
            pages.append(_page_result(image, 1, deadline))
            image.close()
    except HTTPException:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, ValueError) as error:
        raise HTTPException(status_code=422, detail="The document could not be decoded.") from error
    except TimeoutError as error:
        raise HTTPException(status_code=408, detail="OCR processing exceeded its time limit.") from error
    except Exception as error:
        if isinstance(error, pytesseract.TesseractNotFoundError):
            raise HTTPException(status_code=503, detail="Local OCR engine is unavailable.") from error
        raise HTTPException(status_code=422, detail="The document could not be processed.") from error

    return OcrResult(
        provider="tesseract-local",
        engineVersion=str(pytesseract.get_tesseract_version()),
        languages="eng+ara",
        pages=pages,
        text="\n".join(page.text for page in pages),
    )


@app.get("/health")
async def health() -> dict[str, str]:
    try:
        languages = set(pytesseract.get_languages(config=""))
        if not {"eng", "ara"}.issubset(languages):
            raise RuntimeError("Required OCR language data is missing.")
        return {"status": "ready", "provider": "tesseract-local"}
    except Exception as error:
        raise HTTPException(status_code=503, detail="Local OCR engine is unavailable.") from error


@app.post("/ocr", response_model=OcrResult)
async def ocr(file: UploadFile = File(...)) -> OcrResult:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported document type.")
    content = await file.read(MAX_DOCUMENT_BYTES + 1)
    if not content or len(content) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=413, detail="Documents are limited to 12 MiB.")
    if not _check_signature(content, file.content_type):
        raise HTTPException(status_code=422, detail="The document signature is invalid.")
    if processing_slots.locked():
        raise HTTPException(status_code=503, detail="The local OCR engine is busy.")
    async with processing_slots:
        return await run_in_threadpool(_process_document, content, file.content_type)
