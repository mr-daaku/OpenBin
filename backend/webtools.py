"""Read a web page as plain text, or download one image, safely.

Deliberately small: stdlib + httpx (already pinned in requirements.txt).

SECURITY: the backend runs on the user's own machine, so every URL is
checked BEFORE the request and again after EVERY redirect:

  * only http:// and https:// (file:// and friends are refused)
  * localhost / 127.0.0.1 / *.localhost / *.local / *.internal
  * private ranges (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x),
    CGNAT (100.64.x), loopback, unspecified, multicast, reserved
  * every address the hostname resolves to must pass the same check
  * images obey the same rules, and must really be an image (the bytes are
    checked, not just the Content-Type header)

Plus hard limits: timeout, redirect count, response size and text length.
"""

import html as html_module
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import httpx

FETCH_TIMEOUT = 15  # seconds for one request
FETCH_TOTAL_TIMEOUT = 30  # ceiling used by callers around the whole fetch
MAX_REDIRECTS = 5
MAX_BYTES = 1_500_000  # never buffer more than 1.5 MB of a page
DEFAULT_CHARS = 6000  # max characters handed to the model
IMAGE_MAX_BYTES = 8 * 1024 * 1024  # same cap as user-uploaded attachments

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Names that never leave this machine.
_BLOCKED_NAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "broadcasthost",
    "0.0.0.0",
    "::1",
    "::",
}
_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".intranet")

_TEXT_TYPES = ("text/", "application/xhtml+xml", "application/xml", "application/json")


class FetchError(Exception):
    """A refused or failed fetch - the message is shown to the user."""


def _check_ip(ip_text: str, host: str) -> None:
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        raise FetchError(f"Blocked: {host} resolved to an unreadable address.")
    # IPv4-mapped IPv6 (::ffff:127.0.0.1) must be judged as its inner IPv4.
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        raise FetchError(f"Blocked: {host} points at a local or private address.")
    if isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"):
        raise FetchError(f"Blocked: {host} points at a private address.")


def assert_public_url(url: str) -> str:
    """Validate scheme + host and resolve every IP. Returns the hostname."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise FetchError("Only http:// and https:// URLs can be read.")
    host = (parsed.hostname or "").strip().lower().rstrip(".")
    if not host:
        raise FetchError("That URL has no host name.")
    if host in _BLOCKED_NAMES or host.endswith(_BLOCKED_SUFFIXES):
        raise FetchError(f"Blocked: {host} is a local address.")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror:
        raise FetchError(f"Could not resolve the host name {host}.")
    if not infos:
        raise FetchError(f"Could not resolve the host name {host}.")
    for info in infos:
        _check_ip(info[4][0], host)
    return host


def html_to_text(raw: str) -> tuple[str, str]:
    """(title, readable text) from an HTML document - no parser dependency."""
    title = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I | re.S)
    if m:
        title = html_module.unescape(m.group(1)).strip()
        title = re.sub(r"\s+", " ", title)

    text = re.sub(r"<!--.*?-->", " ", raw, flags=re.S)
    text = re.sub(
        r"<(script|style|noscript|svg|canvas|template|nav|header|footer|aside|form|iframe|"
        r"object|embed|select|button)[^>]*>.*?</\1>",
        "\n",
        text,
        flags=re.S | re.I,
    )
    text = re.sub(
        r"</?(p|div|section|article|main|li|ul|ol|h[1-6]|tr|td|th|br|blockquote|pre|table|"
        r"figure|figcaption|dt|dd|hr)[^>]*>",
        "\n",
        text,
        flags=re.I,
    )
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_module.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    lines = [ln.strip() for ln in text.split("\n")]
    text = "\n".join(ln for ln in lines if ln)
    return title, re.sub(r"\n{3,}", "\n\n", text).strip()


def _decode(body: bytes, content_type: str) -> str:
    charset = ""
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    if m:
        charset = m.group(1).lower()
    if not charset:
        head = body[:4096].decode("ascii", errors="ignore")
        m = re.search(r"charset=[\"']?([\w-]+)", head, re.I)
        if m:
            charset = m.group(1).lower()
    for enc in (charset, "utf-8", "windows-1252"):
        if not enc:
            continue
        try:
            return body.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode("utf-8", errors="replace")


async def fetch_page(url: str, max_chars: int = DEFAULT_CHARS) -> dict:
    """Fetch a page and return {url, host, title, text, chars}. Raises FetchError."""
    url = (url or "").strip()
    if not url:
        raise FetchError("No URL given.")
    if "://" not in url:
        url = "https://" + url
    url = url.strip()

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "Accept-Language": "en-US,en;q=0.8",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=False, headers=headers) as client:
            body = b""
            content_type = ""
            hops = 0
            while True:
                assert_public_url(url)  # before every request, redirects included
                try:
                    async with client.stream("GET", url, timeout=FETCH_TIMEOUT) as resp:
                        if resp.status_code in (301, 302, 303, 307, 308):
                            location = resp.headers.get("location")
                            if not location:
                                raise FetchError("That page redirected without a location.")
                            hops += 1
                            if hops > MAX_REDIRECTS:
                                raise FetchError("Too many redirects.")
                            url = urljoin(url, location)
                            continue
                        if resp.status_code >= 400:
                            raise FetchError(f"That page answered with HTTP {resp.status_code}.")
                        content_type = resp.headers.get("content-type", "")
                        if content_type and not content_type.lower().startswith(_TEXT_TYPES):
                            raise FetchError("That URL is not a readable text page.")
                        chunks: list[bytes] = []
                        size = 0
                        async for chunk in resp.aiter_bytes():
                            chunks.append(chunk)
                            size += len(chunk)
                            if size >= MAX_BYTES:
                                break
                        body = b"".join(chunks)[:MAX_BYTES]
                except FetchError:
                    raise
                except httpx.TimeoutException:
                    raise FetchError(f"Timed out after {FETCH_TIMEOUT}s.")
                except httpx.HTTPError as exc:
                    raise FetchError(f"Could not fetch that page ({exc.__class__.__name__}).")
                break
    except FetchError:
        raise
    except Exception as exc:  # noqa: BLE001 - anything unexpected is a fetch failure
        raise FetchError(f"Could not fetch that page ({exc.__class__.__name__}).")

    if not body.strip():
        raise FetchError("That page is empty.")

    title, text = html_to_text(_decode(body, content_type))
    if not text:
        raise FetchError("No readable text found on that page.")

    final = urlparse(url)
    return {
        "url": url,
        "host": (final.hostname or "").lower().removeprefix("www."),
        "title": title or (final.hostname or url),
        "text": text[:max_chars],
        "chars": len(text),
    }


# ------------------------------------------------------------------ images

_IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


def sniff_image_mime(body: bytes) -> str:
    """Recognise the image type from the bytes themselves ('' when unknown).

    A lying or missing Content-Type must not smuggle HTML/JSON to the model
    as if it were a picture, so the header alone is never trusted."""
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    for magic, mime in _IMAGE_MAGIC:
        if body.startswith(magic):
            return mime
    if len(body) >= 2 and body[:2] == b"BM":
        return "image/bmp"
    return ""


async def fetch_image(url: str, max_bytes: int = IMAGE_MAX_BYTES) -> dict:
    """Download one image, guarded exactly like fetch_page (same SSRF checks
    before every request and every redirect hop).

    Returns {url, mime, data(bytes)}. Raises FetchError."""
    url = (url or "").strip()
    if not url:
        raise FetchError("No URL given.")
    if "://" not in url:
        url = "https://" + url
    url = url.strip()

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "image/*,*/*;q=0.1",
    }

    body = b""
    header_mime = ""
    hops = 0
    try:
        async with httpx.AsyncClient(follow_redirects=False, headers=headers) as client:
            while True:
                assert_public_url(url)  # before every request, redirects included
                try:
                    async with client.stream("GET", url, timeout=FETCH_TIMEOUT) as resp:
                        if resp.status_code in (301, 302, 303, 307, 308):
                            location = resp.headers.get("location")
                            if not location:
                                raise FetchError("That image redirected without a location.")
                            hops += 1
                            if hops > MAX_REDIRECTS:
                                raise FetchError("Too many redirects.")
                            url = urljoin(url, location)
                            continue
                        if resp.status_code >= 400:
                            raise FetchError(f"That image answered with HTTP {resp.status_code}.")
                        header_mime = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                        chunks: list[bytes] = []
                        size = 0
                        async for chunk in resp.aiter_bytes():
                            chunks.append(chunk)
                            size += len(chunk)
                            if size >= max_bytes:
                                break
                        body = b"".join(chunks)
                except FetchError:
                    raise
                except httpx.TimeoutException:
                    raise FetchError(f"Timed out after {FETCH_TIMEOUT}s.")
                except httpx.HTTPError as exc:
                    raise FetchError(f"Could not download that image ({exc.__class__.__name__}).")
                break
    except FetchError:
        raise
    except Exception as exc:  # noqa: BLE001 - anything unexpected is a fetch failure
        raise FetchError(f"Could not download that image ({exc.__class__.__name__}).")

    if not body:
        raise FetchError("That image is empty.")
    if len(body) >= max_bytes:
        raise FetchError(f"That image is larger than {max_bytes // (1024 * 1024)} MB.")
    sniffed = sniff_image_mime(body)
    if not sniffed:
        detail = f" ({header_mime})" if header_mime else ""
        raise FetchError(f"That URL does not return a recognisable image{detail}.")
    return {"url": url, "mime": sniffed, "data": body}
