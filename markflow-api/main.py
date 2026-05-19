import os
import tempfile
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from pdf_pipeline import improve_pdf_markdown

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

@app.post("/api/convert/pdf")
@app.post("/convert/pdf")
async def convert_pdf(
    file: UploadFile = File(...),
    api_key: str = Form(...),
    flavor: str = Form("auto")
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
        
    temp_path = ""
    try:
        # Save uploaded file to a temporary location
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name

        flavor_name = flavor if flavor != 'auto' else 'GitHub Flavored Markdown'
        final_md = improve_pdf_markdown(
            pdf_path=temp_path,
            api_key=api_key,
            model='gemini-3.1-pro-preview',
            chunk_size=3,
            flavor_name=flavor_name,
        )
        return {"markdown": final_md}

    except Exception as e:
        print(f"Error converting PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Clean up temp file
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
