#!/usr/bin/env bash
set -euo pipefail

repository="${AGENTD_REPOSITORY:-cvsloane/agent-commander}"
requested_version="${1:-latest}"
install_dir="${AGENTD_INSTALL_DIR:-/usr/local/bin}"
service_name="${AGENTD_SERVICE:-agentd}"

case "$(uname -m)" in
  x86_64|amd64) architecture="amd64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "agentd release artifacts are currently published for Linux only" >&2
  exit 1
fi

if [[ "$requested_version" == "latest" ]]; then
  release_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/${repository}/releases/latest")"
  tag="${release_url##*/}"
else
  tag="$requested_version"
  [[ "$tag" == v* ]] || tag="v${tag}"
fi

version="${tag#v}"
archive_name="agentd_${version}_linux_${architecture}.tar.gz"
download_base="https://github.com/${repository}/releases/download/${tag}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

curl -fsSL "${download_base}/${archive_name}" -o "${work_dir}/${archive_name}"
curl -fsSL "${download_base}/checksums.txt" -o "${work_dir}/checksums.txt"

expected_checksum="$(awk -v artifact="$archive_name" '$2 == artifact { print $1 }' "${work_dir}/checksums.txt")"
if [[ -z "$expected_checksum" ]]; then
  echo "No checksum found for ${archive_name}" >&2
  exit 1
fi
actual_checksum="$(sha256sum "${work_dir}/${archive_name}" | awk '{ print $1 }')"
if [[ "$actual_checksum" != "$expected_checksum" ]]; then
  echo "Checksum mismatch for ${archive_name}" >&2
  exit 1
fi

tar -xzf "${work_dir}/${archive_name}" -C "$work_dir"
"${work_dir}/agentd" version

root_command=()
if [[ "$EUID" -ne 0 ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Run as root or install sudo to replace ${install_dir}/agentd" >&2
    exit 1
  fi
  root_command=(sudo)
fi

"${root_command[@]}" install -d -m 0755 "$install_dir"
"${root_command[@]}" install -m 0755 "${work_dir}/agentd" "${install_dir}/agentd.new"
"${root_command[@]}" mv "${install_dir}/agentd.new" "${install_dir}/agentd"
"${root_command[@]}" systemctl restart "$service_name"
"${root_command[@]}" systemctl is-active --quiet "$service_name"

echo "Installed agentd ${version} and restarted ${service_name}.service"
