"""Outbound protection for user-supplied endpoints (openai_compatible).

Every connection resolves the host itself, rejects non-public addresses and connects to the
exact address it checked, so a DNS answer that changes between check and use cannot redirect it.
"""

import asyncio
import ipaddress
import socket
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from typing import Any

import httpcore2
import httpx2

from criteria.adapters.llm.retry import TransientRetryTransport
from criteria.ports.models import EndpointRejectedError

Resolver = Callable[[str, int], Awaitable[list[str]]]

NAT64_PREFIX = ipaddress.IPv6Network("64:ff9b::/96")


class EndpointNotAllowedError(EndpointRejectedError):
    pass


class ResponseTooLargeError(Exception):
    pass


async def resolve_host(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


def _embedded_ipv4(ip: ipaddress.IPv6Address) -> list[ipaddress.IPv4Address]:
    embedded = [ip.ipv4_mapped, ip.sixtofour, ip.teredo[1] if ip.teredo else None]
    if ip in NAT64_PREFIX:
        embedded.append(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
    return [address for address in embedded if address is not None]


def is_public_address(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError:
        return False
    candidates: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = [ip]
    if isinstance(ip, ipaddress.IPv6Address):
        candidates.extend(_embedded_ipv4(ip))
    return all(
        candidate.is_global and not candidate.is_multicast and not candidate.is_reserved
        for candidate in candidates
    )


def validate_endpoint_url(url: str) -> httpx2.URL:
    parsed = httpx2.URL(url)
    if parsed.scheme != "https":
        raise EndpointNotAllowedError("the endpoint must use https")
    if parsed.userinfo:
        raise EndpointNotAllowedError("the endpoint URL must not carry credentials")
    if not parsed.host:
        raise EndpointNotAllowedError("the endpoint URL has no host")
    try:
        literal = ipaddress.ip_address(parsed.host)
    except ValueError:
        return parsed
    if not is_public_address(str(literal)):
        raise EndpointNotAllowedError("the endpoint address is not public")
    return parsed


class GuardedNetworkBackend(httpcore2.AsyncNetworkBackend):
    def __init__(
        self,
        resolver: Resolver = resolve_host,
        inner: httpcore2.AsyncNetworkBackend | None = None,
    ) -> None:
        self._resolver = resolver
        self._inner = inner or httpcore2.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109  signature defined by httpcore2
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore2.AsyncNetworkStream:
        addresses = await self._resolver(host, port)
        if not addresses or not all(is_public_address(address) for address in addresses):
            raise EndpointNotAllowedError("the endpoint resolves to a non-public address")
        stream = await self._inner.connect_tcp(
            addresses[0],
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )
        peer = stream.get_extra_info("server_addr")
        if peer is None or not is_public_address(str(peer[0])):
            await stream.aclose()
            raise EndpointNotAllowedError("the connected address is not public")
        return stream

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109  signature defined by httpcore2
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore2.AsyncNetworkStream:
        raise EndpointNotAllowedError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class _LimitedStream(httpx2.AsyncByteStream):
    def __init__(self, inner: httpx2.AsyncByteStream, max_bytes: int) -> None:
        self._inner = inner
        self._max_bytes = max_bytes

    async def __aiter__(self) -> AsyncIterator[bytes]:
        received = 0
        async for chunk in self._inner:
            received += len(chunk)
            if received > self._max_bytes:
                raise ResponseTooLargeError("the endpoint response exceeds the size limit")
            yield chunk

    async def aclose(self) -> None:
        await self._inner.aclose()


class GuardedTransport(httpx2.AsyncBaseTransport):
    """Refuses redirects and caps the response size on top of any inner transport."""

    def __init__(self, inner: httpx2.AsyncBaseTransport, max_response_bytes: int) -> None:
        self._inner = inner
        self._max_bytes = max_response_bytes

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        validate_endpoint_url(str(request.url))
        response = await self._inner.handle_async_request(request)
        if httpx2.codes.is_redirect(response.status_code):
            await response.aclose()
            raise EndpointNotAllowedError("the endpoint answered with a redirect")
        declared = response.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > self._max_bytes:
            await response.aclose()
            raise ResponseTooLargeError("the endpoint response exceeds the size limit")
        if not isinstance(response.stream, httpx2.AsyncByteStream):
            raise TypeError("expected an async response stream")
        return httpx2.Response(
            status_code=response.status_code,
            headers=response.headers,
            stream=_LimitedStream(response.stream, self._max_bytes),
            extensions=response.extensions,
            request=request,
        )

    async def aclose(self) -> None:
        await self._inner.aclose()


def network_transport(backend: httpcore2.AsyncNetworkBackend) -> httpx2.AsyncHTTPTransport:
    transport = httpx2.AsyncHTTPTransport(trust_env=False, retries=0)
    # httpx has no hook for the network backend; swapping the pool keeps its error mapping.
    transport._pool = httpcore2.AsyncConnectionPool(
        ssl_context=httpx2.create_ssl_context(trust_env=False),
        network_backend=backend,
        retries=0,
    )
    return transport


def guarded_client(
    *,
    timeout_seconds: float,
    max_response_bytes: int,
    backend: httpcore2.AsyncNetworkBackend | None = None,
    inner: httpx2.AsyncBaseTransport | None = None,
) -> httpx2.AsyncClient:
    network = TransientRetryTransport(network_transport(backend or GuardedNetworkBackend()))
    transport = GuardedTransport(inner or network, max_response_bytes)
    return httpx2.AsyncClient(
        transport=transport,
        timeout=httpx2.Timeout(timeout_seconds),
        follow_redirects=False,
        trust_env=False,
    )
