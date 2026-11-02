import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sys.dont_write_bytecode = True
vm = load("vm-rollout")
gateway = load("ssh-gateway")
COMMIT = "c" * 40
IMAGE = "ghcr.io/hepangda/avalon@sha256:" + "a" * 64
VERSION = "sha-" + COMMIT


class FakeDeployment(vm.Deployment):
    def __init__(self, root):
        super().__init__({"directory": str(root), "repository": "ghcr.io/hepangda/avalon",
                          "backup_directory": str(root / "backups")})
        self.calls = []
        self.current = "old"
        self.valid_health = True
        self.backup_failure = False
        self.start_failure = False
        self.metadata = {"Id": "new", "Architecture": "arm64", "Os": "linux",
                         "Config": {"Labels": {"avalon.runtime": "rust",
                                              "org.opencontainers.image.revision": COMMIT}}}

    def preflight(self):
        return {"Image": self.current, "State": {"Running": True}}

    def inspect(self, reference, image=False):
        return self.metadata

    def run(self, args, **kwargs):
        self.calls.append(args)
        if "up" in args:
            if self.start_failure:
                raise subprocess.CalledProcessError(1, args)
            self.current = "new"

    def healthy(self, image):
        return self.valid_health and self.current == image

    def backup(self, version):
        self.calls.append(["backup"])
        if self.backup_failure:
            raise RuntimeError("Backup failed")
        return "backup.dump"


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.env = self.root / ".env"
        self.original = "APP_IMAGE='old'\nDATABASE_URL='secret-do-not-change'\nOIDC_SESSION_SECRET='stable'\n"
        self.env.write_text(self.original)
        self.deployment = FakeDeployment(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_reject_invalid_images_before_stop(self):
        for field, value in [("Architecture", "amd64"), ("Os", "windows")]:
            with self.subTest(field=field):
                d = FakeDeployment(self.root)
                d.metadata[field] = value
                with self.assertRaises(ValueError):
                    d.deploy(IMAGE, VERSION)
                self.assertFalse(any("stop" in c for c in d.calls))
                self.assertEqual(self.env.read_text(), self.original)
        for field, value in [("avalon.runtime", "node"), ("org.opencontainers.image.revision", "d" * 40)]:
            d = FakeDeployment(self.root)
            d.metadata["Config"]["Labels"][field] = value
            with self.assertRaises(ValueError):
                d.deploy(IMAGE, VERSION)
            self.assertFalse(any("stop" in c for c in d.calls))

    def test_repository_and_digest_are_enforced(self):
        for image in ["ghcr.io/attacker/avalon@sha256:" + "a" * 64, "ghcr.io/hepangda/avalon:latest", IMAGE + "; id"]:
            with self.assertRaises(ValueError):
                self.deployment.deploy(image, VERSION)
        self.assertEqual(self.deployment.calls, [])

    def test_backup_failure_leaves_running_app_and_env_untouched(self):
        self.deployment.backup_failure = True
        with self.assertRaisesRegex(RuntimeError, "Backup failed"):
            self.deployment.deploy(IMAGE, VERSION)
        self.assertFalse(any("stop" in c for c in self.deployment.calls))
        self.assertEqual(self.env.read_text(), self.original)

    def test_success_stops_old_writer_before_start_and_never_recreates_db(self):
        d = self.deployment
        d.deploy(IMAGE, VERSION)
        names = ["backup" if c == ["backup"] else next((x for x in ("pull", "stop", "up") if x in c), "other") for c in d.calls]
        self.assertLess(names.index("pull"), names.index("backup"))
        self.assertLess(names.index("backup"), names.index("stop"))
        self.assertLess(names.index("stop"), names.index("up"))
        up = next(c for c in d.calls if "up" in c)
        self.assertIn("--no-deps", up)
        self.assertEqual(up[-1], "app")
        self.assertEqual(self.env.read_text(), self.original.replace("APP_IMAGE='old'", "APP_IMAGE='" + IMAGE + "'"))
        self.assertEqual(self.env.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((self.root / "release.json").read_text())["image"], IMAGE)

    def test_failed_start_does_not_rollback(self):
        self.deployment.start_failure = True
        with self.assertRaises(subprocess.CalledProcessError):
            self.deployment.deploy(IMAGE, VERSION)
        self.assertIn(IMAGE, self.env.read_text())
        self.assertEqual(sum("up" in c for c in self.deployment.calls), 1)
        self.assertFalse((self.root / "release.json").exists())

    def test_unhealthy_new_image_fails_without_rollback(self):
        self.deployment.valid_health = False
        with patch.object(vm.time, "sleep"), self.assertRaisesRegex(RuntimeError, "health check"):
            self.deployment.deploy(IMAGE, VERSION)
        self.assertIn(IMAGE, self.env.read_text())
        self.assertEqual(sum("up" in c for c in self.deployment.calls), 1)

    def test_same_healthy_image_noop_and_explicit_restart(self):
        self.deployment.current = "new"
        self.deployment.deploy(IMAGE, VERSION)
        self.assertFalse(any("stop" in c for c in self.deployment.calls))
        self.deployment.deploy(IMAGE, VERSION, restart=True)
        self.assertTrue(any("stop" in c for c in self.deployment.calls))

    def test_stopped_same_image_is_restarted(self):
        self.deployment.current = "new"
        with patch.object(self.deployment, "healthy", side_effect=[False, True]):
            self.deployment.deploy(IMAGE, VERSION)
        self.assertTrue(any("up" in c for c in self.deployment.calls))

    def test_preflight_rejects_missing_or_unhealthy_database(self):
        d = vm.Deployment({"directory": str(self.root), "repository": "unused", "backup_directory": str(self.root)})
        for state in [{"Running": False}, {"Running": True, "Health": {"Status": "unhealthy"}}]:
            with patch.object(d, "run"), patch.object(d, "container", return_value={"State": state}):
                with self.assertRaisesRegex(RuntimeError, "Database"):
                    d.preflight()

    def test_gateway_rejects_shell_and_extra_arguments(self):
        self.assertEqual(gateway.parse_command("check"), ["--check"])
        self.assertEqual(gateway.parse_command(f"deploy {IMAGE} {VERSION} --restart"), [IMAGE, VERSION, "--restart"])
        for command in ["", "sh", "check; id", "check extra", f"deploy {IMAGE} {VERSION} --directory /tmp", f"deploy {IMAGE} {VERSION}; id", 'deploy "$(id)" x']:
            with self.assertRaises(ValueError):
                gateway.parse_command(command)


if __name__ == "__main__":
    unittest.main()
