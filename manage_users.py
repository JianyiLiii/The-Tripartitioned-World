#!/usr/bin/env python3
"""Manage approvals and initial administrators from the server owner's shell."""

import argparse
import getpass
import secrets
from pathlib import Path

from access_control import (AccessConfigError, DEFAULT_PASSWORD, hash_password,
                            load_document, normalized_name, write_document)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Manage The Tripartitioned World user access list.")
    parser.add_argument("--file", default=str(Path(__file__).resolve().parent / "config" / "access-users.json"))
    parser.add_argument("command", choices=("init", "add", "reset", "rotate", "disable", "enable", "list"))
    parser.add_argument("name", nargs="?")
    parser.add_argument("--admin", action="store_true", help="Allow a newly added user to add members on the website")
    parser.add_argument("--prompt-password", action="store_true",
                        help="Securely enter a custom six-digit initial password for add/reset/rotate")
    args = parser.parse_args(argv)
    if args.admin and args.command != "add":
        parser.error("--admin is only supported when adding a user.")
    if args.prompt_password and args.command not in ("add", "reset", "rotate"):
        parser.error("--prompt-password is only supported for add, reset and rotate.")
    path = Path(args.file).expanduser().resolve()
    try:
        if args.command == "init":
            if path.exists():
                parser.error("File already exists; it was not changed.")
            write_document(path, {"version": 1, "users": []})
            print(f"Created empty access list: {path}")
            return
        document = load_document(path)
        if args.command == "list":
            for entry in document["users"]:
                print(f"{'enabled ' if entry['enabled'] else 'disabled'}  {entry['name']}")
            print(f"{len(document['users'])} user(s). File: {path}")
            return
        if not args.name:
            parser.error("A user name is required.")
        name = normalized_name(args.name)
        entry = next((entry for entry in document["users"]
                      if normalized_name(entry["name"]).casefold() == name.casefold()), None)
        if args.command == "add" and entry:
            parser.error("User already exists. Use reset to restore the initial password.")
        if args.command != "add" and not entry:
            parser.error("User not found.")
        if args.command in ("add", "reset", "rotate"):
            password = DEFAULT_PASSWORD
            if args.prompt_password:
                password = getpass.getpass("Initial password (six digits): ")
                if password != getpass.getpass("Confirm initial password: "):
                    parser.error("Passwords do not match; nothing was changed.")
            encoded = hash_password(password)
            if entry is None:
                entry = {"name": name, "enabled": True, "admin": args.admin}
                document["users"].append(entry)
            entry["passwordHash"] = encoded
            entry["passwordRevision"] = secrets.token_urlsafe(24)
        elif args.command in ("disable", "enable"):
            entry["enabled"] = args.command == "enable"
        # Also revoke old sessions when a disabled user is re-enabled.
        entry["revision"] = secrets.token_urlsafe(24)
        write_document(path, document)
        print(f"Updated {entry['name']}: {'enabled' if entry['enabled'] else 'disabled'}. File: {path}")
        if args.command in ("add", "reset", "rotate"):
            print("Initial password set. Users can change it from their profile menu.")
    except (AccessConfigError, ValueError, OSError) as err:
        parser.error(str(err))


if __name__ == "__main__":
    main()
