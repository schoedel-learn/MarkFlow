import os
import tempfile
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pymupdf4llm
from google import genai

app = FastAPI(title="MarkFlow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok"}

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

        import pymupdf
        doc = pymupdf.open(temp_path)
        total_pages = len(doc)
        
        client = genai.Client(api_key=api_key)
        flavor_name = flavor if flavor != 'auto' else 'GitHub Flavored Markdown'
        
        full_markdown = []
        
        # Process in chunks of 3 pages for high quality and to stay within output limits
        chunk_size = 3
        for i in range(0, total_pages, chunk_size):
            page_range = list(range(i, min(i + chunk_size, total_pages)))
            print(f"Processing pages {page_range} of {total_pages}...")
            
            # 1. Local Extraction for this chunk
            raw_chunk_md = pymupdf4llm.to_markdown(temp_path, pages=page_range)
            
            # 2. AI Formatting for this chunk
            prompt = f"""
            You are an expert document formatter. The following text is raw Markdown extracted from pages {i+1}-{min(i + chunk_size, total_pages)} of a PDF.
            Your task is to cleanly format this into high-quality {flavor_name}.
            
            STRICT RULES:
            1. FIX LINE BREAKS: Join fragmented sentences and paragraphs that were split by page breaks or layout artifacts.
            2. CLEAN TABLES: Ensure all tables are correctly formatted in GFM syntax. 
            3. REMOVE ARTIFACTS: Delete redundant page numbers, running headers/footers, or "hidden" duplicate text that sometimes appears in PDF extractions.
            4. PRESERVE CONTENT: Do not summarize. Keep all dates, names, and liturgical data exactly as provided.
            5. HIERARCHY: Use appropriate heading levels (#, ##, ###) to represent the document structure.
            6. Output ONLY the raw {flavor_name}. No conversational text.
            
            RAW DATA:
            {raw_chunk_md}
            """
            
            response = client.models.generate_content(
                model='gemini-3.1-pro-preview',
                contents=prompt,
            )
            
            if response.text:
                full_markdown.append(response.text)
            else:
                # Fallback to raw if AI fails for some reason
                full_markdown.append(raw_chunk_md)
        
        final_md = "\n\n---\n\n".join(full_markdown)
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
