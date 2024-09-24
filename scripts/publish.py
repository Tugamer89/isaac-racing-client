""" This is the script that publishes a new version of the client to GitHub. """

# pylint: disable=line-too-long, missing-function-docstring, wrong-import-position

import sys

if sys.version_info < (3, 0):
    print("This script requires Python 3.")
    sys.exit(1)

# Standard imports
import json
import os
import re
import subprocess

# Non-standard imports
import dotenv
import psutil
import paramiko

# Constants
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
REPOSITORY_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
REPOSITORY_NAME = os.path.basename(REPOSITORY_DIR)
VERSION_URL = (
    "https://raw.githubusercontent.com/Tugamer89/racing-plus/main/mod/version.txt"
)


def main():
    os.chdir(REPOSITORY_DIR)

    # Load environment variables
    dotenv.load_dotenv(os.path.join(REPOSITORY_DIR, ".env"))
    validate_environment_variables()

    version = get_incremented_version_from_package_json()
    write_version_to_package_json(version)
    ensure_localhost_false()
    git_commit(version)
    close_existing_electron()
    build_javascript()
    build_and_publish_electron(version)
    set_latest_client_version_on_server(version)

    print(f"Released version {version} successfully.")


def validate_environment_variables():
    environment_variables_to_check = [
        "GH_TOKEN",
        "VPS_IP",
        "VPS_USER",
        "VPS_PASS",
    ]
    for environment_variable_name in environment_variables_to_check:
        environment_variable = os.environ.get(environment_variable_name)
        if environment_variable is None or environment_variable == "":
            error(
                f'error: {environment_variable_name} is missing or blank in the ".env" file'
            )


def get_incremented_version_from_package_json():
    with open("package.json", encoding="utf8") as package_json:
        data = json.load(package_json)
    existing_version = data["version"]

    major, minor, patch = parse_semantic_version(existing_version)
    incremented_patch = patch + 1

    return f"{major}.{minor}.{incremented_patch}"


def write_version_to_package_json(version: str):
    match_regex = r'  "version": "\d+.\d+\.\d+",'
    replace = f'  "version": "{version}",'
    find_and_replace_in_file(match_regex, replace, "package.json")


def ensure_localhost_false():
    # Make sure that the localhost version of the client is not activated
    constants_file = os.path.join(REPOSITORY_DIR, "src", "renderer", "constants.ts")
    find_and_replace_in_file(
        "const localhost = true;", "const localhost = false;", constants_file
    )


def git_commit(version: str):
    # Throw an error if this is not a git repository
    return_code = subprocess.call(
        ["git", "status"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    if return_code != 0:
        error("This is not a git repository.")

    # Check to see if there are any changes
    # https://stackoverflow.com/questions/3878624/how-do-i-programmatically-determine-if-there-are-uncommitted-changes
    return_code = subprocess.call(["git", "diff-index", "--quiet", "HEAD", "--"])
    if return_code == 0:
        # There are no changes
        print("There are no changes to commit.")
        return

    # Commit to the client repository
    return_code = subprocess.call(["git", "add", "-A"])
    if return_code != 0:
        error("Failed to git add.")
    return_code = subprocess.call(["git", "commit", "-m", version])
    if return_code != 0:
        error("Failed to git commit.")
    return_code = subprocess.call(["git", "pull", "--rebase"])
    if return_code != 0:
        error("Failed to git pull.")
    return_code = subprocess.call(["git", "push"])
    if return_code != 0:
        error("Failed to git push.")


def close_existing_electron():
    # Having Electron open can cause corrupted ASAR archives
    for process in psutil.process_iter():
        if process.name() == "electron.exe":
            process.kill()


def build_javascript():
    return_code = subprocess.call(["bash", "./build.sh"], shell=True)
    if return_code != 0:
        error("Failed to build the JavaScript.")


def build_and_publish_electron(version: str):
    print("Building:", REPOSITORY_NAME, version)
    return_code = subprocess.call(
        ["npx", "electron-builder", "--publish", "always"], shell=True
    )
    if return_code != 0:
        error("Failed to run electron-builder.")


def set_latest_client_version_on_server(version: str):
    latest_client_version_file = "latest_client_version.txt"

    with open(latest_client_version_file, "w", encoding="utf8") as version_file:
        print(version, file=version_file)

    private_key_path = "../coppia_chiavi.pem"
    private_key = paramiko.RSAKey.from_private_key_file(private_key_path)

    transport = paramiko.Transport((os.environ.get("VPS_IP"), 22))
    transport.connect(username=os.environ.get("VPS_USER"), pkey=private_key)
    sftp = paramiko.SFTPClient.from_transport(transport)
    remote_path = "isaac-racing-server/" + latest_client_version_file
    sftp.put(latest_client_version_file, remote_path)
    transport.close()

    os.remove(latest_client_version_file)


def parse_semantic_version(version: str):
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", version)
    if not match:
        error(f"Failed to parse the version: {version}")

    major_version = int(match.group(1))
    minor_version = int(match.group(2))
    patch_version = int(match.group(3))

    return major_version, minor_version, patch_version


# From: http://stackoverflow.com/questions/17140886/how-to-search-and-replace-text-in-a-file-using-python
def find_and_replace_in_file(match_regex: str, replace: str, file_path: str):
    with open(file_path, "r", encoding="utf8") as file_handle:
        file_data = file_handle.read()

    new_file = ""
    for line in iter(file_data.splitlines()):
        match = re.search(match_regex, line)
        if match:
            new_file += replace + "\n"
        else:
            new_file += line + "\n"

    with open(file_path, "w", newline="\n", encoding="utf8") as file:
        file.write(new_file)


def error(message):
    print(message)
    sys.exit(1)


if __name__ == "__main__":
    main()
