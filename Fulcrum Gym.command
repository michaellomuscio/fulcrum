#!/bin/bash
# Double-click to open the Fulcrum Gym in Chrome. It runs a tiny web server on this Mac only
# (Chrome lets pages talk to USB devices like the Arduino only from your own computer).
# Close this window when you're done.
cd "$(dirname "$0")"
PORT=8642
URL="http://localhost:$PORT/gym/"
if lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  open -a "Google Chrome" "$URL"
  exit 0
fi
(sleep 1; open -a "Google Chrome" "$URL") &
echo "Fulcrum Gym is running at $URL"
echo "Leave this window open while you use it. Close it (or press Control-C) to stop."
exec python3 -m http.server "$PORT" --bind 127.0.0.1
