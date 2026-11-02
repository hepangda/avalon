#!/usr/bin/python3
"""Forced command for the CI key; installed root-owned on the VM."""
import os
import re
import shlex
import sys


def parse_command(command):
    args = shlex.split(command)
    if args == ["check"]:
        return ["--check"]
    if len(args) not in (3, 4) or args[0] != "deploy":
        raise ValueError("Only check or deploy is permitted")
    if not re.fullmatch(r"ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}", args[1]):
        raise ValueError("Expected a digest-pinned GHCR image")
    if not re.fullmatch(r"sha-[a-f0-9]{40}", args[2]):
        raise ValueError("Expected a full commit SHA")
    if len(args) == 4 and args[3] != "--restart":
        raise ValueError("Unknown option")
    return args[1:]


if __name__ == "__main__":
    try:
        args = parse_command(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except ValueError as error:
        print(error, file=sys.stderr)
        sys.exit(2)
    os.execv("/usr/bin/sudo", ["sudo", "-n", "/usr/local/sbin/avalon-vm-rollout", *args])
