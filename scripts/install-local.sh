#!/bin/sh
# Pack (prepack builds) and install this package into the sites that use it, for
# testing before it is published. Usage: scripts/install-local.sh <site dir>...
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
for site in "$@"; do
  mkdir -p "$site/vendor"
  tgz=$(cd "$here" && npm pack --silent --pack-destination "$site/vendor")
  npm --prefix "$site" install "$site/vendor/$tgz" --no-audit --no-fund >/dev/null
  echo "installed $tgz in $site"
done
