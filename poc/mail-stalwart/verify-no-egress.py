"""Chạy trong mail-stalwart_internal để chứng minh mạng không có Internet."""

import socket

try:
    socket.create_connection(("1.1.1.1", 443), timeout=2).close()
except OSError:
    print("PASS: internal network blocks Internet egress")
else:
    raise SystemExit("FAIL: internal network unexpectedly has Internet egress")
