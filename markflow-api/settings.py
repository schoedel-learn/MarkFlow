import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    firebase_project_id: str = os.getenv(
        "FIREBASE_PROJECT_ID", "gen-lang-client-0879285190"
    )
    allowlist_collection: str = os.getenv("ALLOWLIST_COLLECTION", "approved_users")
    storage_bucket: str = os.getenv("FIREBASE_STORAGE_BUCKET", "")
    service_base_url: str = os.getenv(
        "SERVICE_BASE_URL", os.getenv("MARKFLOW_SERVICE_BASE_URL", "")
    )
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
    pdf_chunk_size: int = int(os.getenv("PDF_CHUNK_SIZE", "3"))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()