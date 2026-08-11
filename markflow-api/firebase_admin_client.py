from functools import lru_cache

import firebase_admin
from firebase_admin import auth, firestore, storage

from settings import get_settings


@lru_cache(maxsize=1)
def get_firebase_app():
    try:
        return firebase_admin.get_app()
    except ValueError:
        settings = get_settings()
        options: dict[str, str] = {}
        if settings.firebase_project_id:
            options["projectId"] = settings.firebase_project_id
        if settings.storage_bucket:
            options["storageBucket"] = settings.storage_bucket
        return firebase_admin.initialize_app(options=options or None)


def get_firestore_client():
    settings = get_settings()
    app = get_firebase_app()
    if settings.firestore_database_id:
        return firestore.client(app=app, database_id=settings.firestore_database_id)
    return firestore.client(app=app)


def get_storage_bucket():
    settings = get_settings()
    app = get_firebase_app()
    if settings.storage_bucket:
        return storage.bucket(settings.storage_bucket, app=app)
    return storage.bucket(app=app)


def get_auth_client():
    """Return the Firebase Auth admin module, ensuring the app is initialized."""
    get_firebase_app()
    return auth