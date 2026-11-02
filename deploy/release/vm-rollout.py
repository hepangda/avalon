#!/usr/bin/python3
"""Root-owned VM release entrypoint. Never restores an old image or database."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.request


def atomic_write(path, text):
    previous = path.stat() if path.exists() else None
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".release-")
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            if previous:
                os.fchown(stream.fileno(), previous.st_uid, previous.st_gid)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def replace_image(text, image):
    result, count = re.subn(r"^APP_IMAGE=.*$", "APP_IMAGE='" + image + "'", text, flags=re.M)
    if count != 1:
        raise ValueError(".env must contain exactly one APP_IMAGE entry")
    return result


class Deployment:
    def __init__(self, config):
        self.root = Path(config["directory"])
        self.repository = config["repository"]
        self.backups = Path(config["backup_directory"])
        self.compose = ["docker", "compose", "--project-directory", str(self.root),
                        "--env-file", str(self.root / ".env"), "-f", str(self.root / "compose.yaml")]

    def run(self, args, capture=False, **kwargs):
        return subprocess.run(args, check=True, text=True, stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE if capture else None, **kwargs).stdout

    def inspect(self, reference, image=False):
        return json.loads(self.run(["docker", *( ["image"] if image else []),
                                    "inspect", reference], capture=True))[0]

    def container(self, service):
        ids = self.run([*self.compose, "ps", "--all", "-q", service], capture=True).split()
        if len(ids) != 1:
            raise RuntimeError(f"Expected one existing {service} container")
        return self.inspect(ids[0])

    def preflight(self):
        self.run([*self.compose, "config", "--quiet"])
        db = self.container("db")
        if not db["State"]["Running"] or db["State"].get("Health", {}).get("Status") != "healthy":
            raise RuntimeError("Database must already be running and healthy; release will not start it")
        return self.container("app")

    def healthy(self, expected_id):
        try:
            app = self.container("app")
            if app["Image"] != expected_id or not app["State"]["Running"]:
                return False
            # Ignore proxy environment variables: this must check the local app.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open("http://127.0.0.1:3000/api/health", timeout=5) as response:
                return json.load(response).get("ok") is True
        except (OSError, ValueError, subprocess.CalledProcessError):
            return False

    def backup(self, version):
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, name = tempfile.mkstemp(prefix=version + "-", suffix=".dump", dir=self.backups)
        try:
            with os.fdopen(fd, "wb") as stream:
                subprocess.run([*self.compose, "exec", "-T", "db", "pg_dump", "-U", "avalon",
                                "-d", "avalon", "-Fc", "--no-owner", "--no-acl"],
                               stdin=subprocess.DEVNULL, stdout=stream, check=True)
                stream.flush()
                os.fsync(stream.fileno())
            if Path(name).stat().st_size == 0:
                raise RuntimeError("Empty database backup")
        except BaseException:
            Path(name).unlink(missing_ok=True)
            raise
        return name

    def check(self):
        app = self.preflight()
        metadata = self.inspect(app["Image"], image=True)
        if metadata["Architecture"] != "arm64" or metadata["Config"].get("Labels", {}).get("avalon.runtime") != "rust":
            raise RuntimeError("Current application is not ARM64 Rust")
        if not self.healthy(app["Image"]):
            raise RuntimeError("Current application is unhealthy")
        print("VM preflight passed: database healthy, ARM64 Rust application healthy")

    def deploy(self, image, version, restart=False):
        if not re.fullmatch(re.escape(self.repository) + r"@sha256:[a-f0-9]{64}", image):
            raise ValueError("Image must be a digest from the configured repository")
        if not re.fullmatch(r"sha-[a-f0-9]{40}", version):
            raise ValueError("Expected sha-<full commit>")
        current = self.preflight()
        self.run(["docker", "pull", "--platform", "linux/arm64", image])
        metadata = self.inspect(image, image=True)
        labels = metadata["Config"].get("Labels") or {}
        if metadata["Architecture"] != "arm64" or metadata["Os"] != "linux" or labels.get("avalon.runtime") != "rust":
            raise ValueError("Refusing an image that is not Linux ARM64 Rust")
        if labels.get("org.opencontainers.image.revision") != version.removeprefix("sha-"):
            raise ValueError("Image revision does not match requested commit")
        env = self.root / ".env"
        updated = replace_image(env.read_text(), image)
        # Validate the new configuration before stopping anything, without logging secrets.
        self.run([*self.compose, "config", "--quiet"], env={**os.environ, "APP_IMAGE": image})
        if current["Image"] == metadata["Id"] and not restart and self.healthy(metadata["Id"]):
            atomic_write(env, updated)
            print(f"{version} is already running and healthy")
            return
        backup = self.backup(version)
        self.run([*self.compose, "stop", "--timeout", "30", "app"])
        atomic_write(env, updated)
        self.run([*self.compose, "up", "-d", "--no-deps", "--pull", "never", "--force-recreate", "app"])
        for attempt in range(30):
            if self.healthy(metadata["Id"]):
                atomic_write(self.root / "release.json", json.dumps({
                    "image": image, "version": version, "previous_image_id": current["Image"],
                    "backup": backup, "released_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }, indent=2) + "\n")
                print(f"Released {version}; local health check passed")
                return
            if attempt < 29:
                time.sleep(2)
        raise RuntimeError("New application failed its local health check")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", nargs="?")
    parser.add_argument("version", nargs="?")
    parser.add_argument("--restart", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check and (args.image or args.version or args.restart):
        parser.error("--check cannot be combined with deployment arguments")
    if not args.check and (not args.image or not args.version):
        parser.error("image and version required")
    config = json.loads(Path("/etc/avalon-deploy.json").read_text())
    deployment = Deployment(config)
    with (deployment.root / ".release.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.check:
            deployment.check()
        else:
            deployment.deploy(args.image, args.version, args.restart)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Release failed: {error}. Automatic rollback is disabled; repair forward.", file=sys.stderr)
        sys.exit(1)
