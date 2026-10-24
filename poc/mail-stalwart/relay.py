"""Fixed local relay with principal-scoped IMAPS session revocation."""

import asyncio
import base64
import hmac
import os
import re
import ssl


PASSTHROUGH_PORTS = (465, 587, 4190, 8080)
IMAPS_PORT = 993
CONTROL_PORT = 19090
MAX_LINE = 16 * 1024
imap_clients: dict[str, set[asyncio.StreamWriter]] = {}


async def close_writer(writer: asyncio.StreamWriter) -> None:
    writer.close()
    try:
        await writer.wait_closed()
    except Exception:
        pass


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while chunk := await reader.read(64 * 1024):
            writer.write(chunk)
            await writer.drain()
    finally:
        await close_writer(writer)


async def passthrough(
    client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter, port: int
) -> None:
    try:
        server_reader, server_writer = await asyncio.open_connection("mail", port)
    except Exception:
        await close_writer(client_writer)
        return
    await asyncio.gather(
        pipe(client_reader, server_writer),
        pipe(server_reader, client_writer),
        return_exceptions=True,
    )


def login_principal(line: bytes) -> str | None:
    text = line.decode("utf-8", "replace").strip()
    login = re.match(r'^\S+\s+LOGIN\s+(?:"([^"]+)"|(\S+))\s+', text, re.I)
    if login:
        return (login.group(1) or login.group(2)).casefold()
    auth = re.match(r"^\S+\s+AUTHENTICATE\s+PLAIN\s+(\S+)\s*$", text, re.I)
    if not auth:
        return None
    try:
        decoded = base64.b64decode(auth.group(1), validate=True).decode("utf-8")
        parts = decoded.split("\0")
        return parts[-2].casefold() if len(parts) >= 2 and parts[-2] else None
    except Exception:
        return None


async def read_tagged_response(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, tag: bytes
) -> bool:
    status = None
    while True:
        response = await reader.readline()
        if not response:
            return False
        writer.write(response)
        await writer.drain()
        if response.startswith(tag + b" "):
            fields = response.split(None, 2)
            status = fields[1].upper() if len(fields) > 1 else b""
            break
    return status == b"OK"


async def imaps(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter) -> None:
    upstream_context = ssl.create_default_context()
    upstream_context.check_hostname = False
    upstream_context.verify_mode = ssl.CERT_NONE
    try:
        server_reader, server_writer = await asyncio.open_connection(
            "mail", IMAPS_PORT, ssl=upstream_context, server_hostname="mail"
        )
        greeting = await server_reader.readline()
        if not greeting:
            raise ConnectionError("missing IMAP greeting")
        client_writer.write(greeting)
        await client_writer.drain()
        principal = None
        while principal is None:
            line = await client_reader.readline()
            if not line or len(line) > MAX_LINE:
                raise ConnectionError("invalid IMAP command")
            fields = line.split(None, 1)
            if not fields:
                continue
            candidate = login_principal(line)
            server_writer.write(line)
            await server_writer.drain()
            authenticated = await read_tagged_response(server_reader, client_writer, fields[0])
            if candidate and authenticated:
                principal = candidate
        imap_clients.setdefault(principal, set()).add(client_writer)
        await asyncio.gather(
            pipe(client_reader, server_writer),
            pipe(server_reader, client_writer),
            return_exceptions=True,
        )
    except Exception:
        await close_writer(client_writer)
    finally:
        if "principal" in locals() and principal:
            clients = imap_clients.get(principal)
            if clients:
                clients.discard(client_writer)
                if not clients:
                    imap_clients.pop(principal, None)


async def control(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        command = await asyncio.wait_for(reader.readline(), timeout=2)
        match = re.fullmatch(rb"AUTH ([^\s]+) KICK IMAP ([^\s]+)\n", command)
        expected = os.environ["MAIL_RELAY_CONTROL_TOKEN"].encode()
        if not match or not hmac.compare_digest(match.group(1), expected):
            writer.write(b"NO\n")
        else:
            principal = match.group(2).decode("utf-8", "strict").casefold()
            clients = list(imap_clients.get(principal, set()))
            await asyncio.gather(*(close_writer(client) for client in clients))
            writer.write(f"OK {len(clients)}\n".encode())
        await writer.drain()
    except Exception:
        writer.write(b"NO\n")
        await writer.drain()
    finally:
        await close_writer(writer)


async def main() -> None:
    tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls_context.load_cert_chain("/relay-tls/cert.pem", "/relay-tls/key.pem")
    servers = [
        await asyncio.start_server(
            lambda r, w, port=port: passthrough(r, w, port), "0.0.0.0", port
        )
        for port in PASSTHROUGH_PORTS
    ]
    servers.append(await asyncio.start_server(imaps, "0.0.0.0", IMAPS_PORT, ssl=tls_context))
    servers.append(await asyncio.start_server(control, "0.0.0.0", CONTROL_PORT))
    await asyncio.gather(*(server.serve_forever() for server in servers))


asyncio.run(main())
