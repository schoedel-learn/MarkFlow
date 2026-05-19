import os
import tempfile
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from entitlements import is_approved_user
from pdf_pipeline import improve_pdf_markdown
from settings import get_settings

app = FastAPI(title="MarkFlow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
@app.get("/health")
async def health_check():
    return {"status": "ok"}


def _ensure_pdf_filename(filename: str | None) -> None:
    if not filename or not filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")


async def _save_upload_to_temp_pdf(file: UploadFile) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        content = await file.read()
        temp_file.write(content)
        return temp_file.name


def _resolve_flavor_name(flavor: str) -> str:
    return flavor if flavor != "auto" else "GitHub Flavored Markdown"


def _convert_pdf_file(
    temp_path: str,
    *,
    api_key: str,
    model: str,
    chunk_size: int,
    flavor: str,
) -> dict[str, str]:
    final_md = improve_pdf_markdown(
        pdf_path=temp_path,
        api_key=api_key,
        model=model,
        chunk_size=chunk_size,
        flavor_name=_resolve_flavor_name(flavor),
    )
    return {"markdown": final_md}

@app.post("/api/convert/pdf")
@app.post("/convert/pdf")
async def convert_pdf(
    file: UploadFile = File(...),
    api_key: str = Form(...),
    flavor: str = Form("auto")
):
    _ensure_pdf_filename(file.filename)

    temp_path = ""
    try:
        temp_path = await _save_upload_to_temp_pdf(file)
        return _convert_pdf_file(
            temp_path,
            api_key=api_key,
            model="gemini-3.1-pro-preview",
            chunk_size=3,
            flavor=flavor,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error converting PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/api/convert/pdf/approved-sync")
@app.post("/convert/pdf/approved-sync")
async def convert_pdf_approved_sync(
    file: UploadFile = File(...),
    user_email: str = Form(...),
    flavor: str = Form("auto"),
):
    _ensure_pdf_filename(file.filename)
    if not is_approved_user(user_email):
        raise HTTPException(status_code=403, detail="Approved access required")

    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Server PDF conversion is not configured")

    temp_path = ""
    try:
        temp_path = await _save_upload_to_temp_pdf(file)
        return _convert_pdf_file(
            temp_path,
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            chunk_size=settings.pdf_chunk_size,
            flavor=flavor,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error converting approved PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
