#!/bin/sh
# Naikkan nomor versi file JS/CSS di index.html agar browser tidak memakai cache lama.
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M)
sed -i '' -E "s#(href|src)=\"(css/[a-z]+\.css|js/[a-z]+\.js)(\?v=[0-9]+)?\"#\1=\"\2?v=$V\"#g" index.html
echo "versi: $V"
