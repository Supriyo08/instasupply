#!/usr/bin/env bash
# Stand-in for sleep, used only by infra/selftest.sh: the wait is written down, not sat through.
echo "sleep $*" >>"$FAKE_LOG"
