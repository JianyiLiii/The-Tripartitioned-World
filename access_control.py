"""Server-owner-managed access list. This module never exposes credentials."""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import unicodedata
from pathlib import Path

SCRYPT_N, SCRYPT_R, SCRYPT_P = 16384, 8, 1
DEFAULT_PASSWORD = "123456"


class AccessConfigError(ValueError):
    pass


def normalized_name(value):
    if not isinstance(value, str) or re.search(r"[\x00-\x1f\x7f]", value):
        raise AccessConfigError("Each user needs a valid name.")
    name = " ".join(unicodedata.normalize("NFKC", value).split())
    if not name or len(name) > 80:
        raise AccessConfigError("Names must contain 1 to 80 characters.")
    return name


def valid_password(code):
    return isinstance(code, str) and re.fullmatch(r"[0-9]{6}", code) is not None


def hash_password(code):
    if not valid_password(code):
        raise ValueError("Passwords must contain exactly six ASCII digits.")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(code.encode("utf-8"), salt=salt, n=SCRYPT_N,
                            r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return "$".join(("scrypt", str(SCRYPT_N), str(SCRYPT_R), str(SCRYPT_P),
                     base64.b64encode(salt).decode(), base64.b64encode(digest).decode()))


def parse_hash(encoded):
    try:
        kind, n, r, p, salt, digest = encoded.split("$")
        if (kind, n, r, p) != ("scrypt", str(SCRYPT_N), str(SCRYPT_R), str(SCRYPT_P)):
            raise ValueError
        salt = base64.b64decode(salt, validate=True)
        digest = base64.b64decode(digest, validate=True)
        if len(salt) != 16 or len(digest) != 32:
            raise ValueError
        return salt, digest
    except (ValueError, TypeError, AttributeError):
        raise AccessConfigError("Invalid password hash; use manage_users.py to reset passwords.")


def verify_password(code, encoded):
    if not valid_password(code):
        return False
    salt, expected = parse_hash(encoded)
    actual = hashlib.scrypt(code.encode("utf-8"), salt=salt, n=SCRYPT_N,
                            r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return hmac.compare_digest(actual, expected)


def validate_document(document):
    if (not isinstance(document, dict) or document.get("version") != 1
            or not isinstance(document.get("users"), list)):
        raise AccessConfigError("Expected {version: 1, users: [...] }.")
    seen = set()
    for entry in document["users"]:
        if not isinstance(entry, dict):
            raise AccessConfigError("Invalid user entry.")
        name = normalized_name(entry.get("name"))
        key = name.casefold()
        if key in seen:
            raise AccessConfigError("Duplicate user names are not allowed.")
        seen.add(key)
        if not isinstance(entry.get("enabled"), bool):
            raise AccessConfigError("Each user needs an enabled boolean.")
        if "admin" in entry and not isinstance(entry["admin"], bool):
            raise AccessConfigError("The admin flag must be a boolean.")
        for field in ("revision", "passwordRevision"):
            if not isinstance(entry.get(field), str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", entry[field]):
                raise AccessConfigError("Each user needs access and password revisions; use manage_users.py.")
        parse_hash(entry.get("passwordHash"))
    return document


def load_document(path):
    try:
        return validate_document(json.loads(Path(path).read_text(encoding="utf-8-sig")))
    except (OSError, UnicodeError, ValueError) as err:
        if isinstance(err, AccessConfigError):
            raise
        raise AccessConfigError("Access list is missing or invalid.") from err


def write_document(path, document):
    """Atomically replace the list. A partial write can never grant access."""
    validate_document(document)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    previous_stat = path.stat() if path.exists() else None
    previous_mode = previous_stat.st_mode & 0o777 if previous_stat else 0o600
    fd, temp = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(document, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, previous_mode)
        if previous_stat and hasattr(os, "chown"):
            os.chown(temp, previous_stat.st_uid, previous_stat.st_gid)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


class AccessList:
    def __init__(self, path):
        self.path = Path(path)

    def entries(self):
        """Read on every request so removal, disable and rotation apply at once."""
        document = load_document(self.path)
        return {normalized_name(entry["name"]).casefold(): entry for entry in document["users"]}


# Unknown users incur the same password hashing work without revealing names.
DUMMY_HASH = ("scrypt$16384$8$1$" + base64.b64encode(b"\0" * 16).decode()
              + "$" + base64.b64encode(b"\0" * 32).decode())
