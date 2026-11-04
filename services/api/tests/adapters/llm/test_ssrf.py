from collections.abc import Iterable
from typing import Any

import httpcore2
import httpx2
import pytest

from criteria.adapters.llm.ssrf import (
    EndpointNotAllowedError,
    GuardedNetworkBackend,
    GuardedTransport,
    ResponseTooLargeError,
    guarded_client,
    is_public_address,
    validate_endpoint_url,
)

PUBLIC_IP = "93.184.215.14"


class FakeStream(httpcore2.AsyncNetworkStream):
    def __init__(self, peer: str) -> None:
        self.peer = peer
        self.closed = False

    async def read(self, max_bytes: int, timeout: float | None = None) -> bytes:  # noqa: ASYNC109
        return b""

    async def write(self, buffer: bytes, timeout: float | None = None) -> None:  # noqa: ASYNC109
        raise AssertionError("no data may be written to a rejected endpoint")

    async def aclose(self) -> None:
        self.closed = True

    def get_extra_info(self, info: str) -> Any:
        return (self.peer, 443) if info == "server_addr" else None


class RecordingBackend(httpcore2.AsyncNetworkBackend):
    """Stands in for the real socket layer and records every connection attempt."""

    def __init__(self, peer: str | None = None) -> None:
        self.connections: list[tuple[str, int]] = []
        self.peer = peer
        self.streams: list[FakeStream] = []

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore2.AsyncNetworkStream:
        self.connections.append((host, port))
        stream = FakeStream(self.peer or host)
        self.streams.append(stream)
        return stream


def resolver(answers: dict[str, list[str]]) -> Any:
    async def resolve(host: str, port: int) -> list[str]:
        return answers.get(host, [host])

    return resolve


class TestEndpointUrl:
    def test_accepts_https_with_a_hostname(self) -> None:
        assert validate_endpoint_url("https://llm.example.com/v1").host == "llm.example.com"

    @pytest.mark.parametrize(
        ("url", "reason"),
        [
            ("http://llm.example.com/v1", "https"),
            ("ftp://llm.example.com", "https"),
            ("https://user:pass@llm.example.com/v1", "credentials"),
            ("https://10.0.0.5/v1", "not public"),
            ("https://192.168.1.50/v1", "not public"),
            ("https://127.0.0.1/v1", "not public"),
            ("https://[::1]/v1", "not public"),
            ("https://169.254.169.254/latest/meta-data", "not public"),
            ("https://[::ffff:127.0.0.1]/v1", "not public"),
            ("https://[::ffff:169.254.169.254]/v1", "not public"),
            ("https://[fd00:ec2::254]/v1", "not public"),
            ("https://[fe80::1]/v1", "not public"),
            ("https://0.0.0.0/v1", "not public"),
        ],
    )
    def test_rejects_insecure_or_private_endpoints(self, url: str, reason: str) -> None:
        with pytest.raises(EndpointNotAllowedError, match=reason):
            validate_endpoint_url(url)


@pytest.mark.parametrize(
    "address",
    [
        "10.1.2.3",
        "172.16.0.1",
        "192.168.0.10",
        "127.0.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "224.0.0.251",
        "255.255.255.255",
        "::1",
        "::",
        "fc00::1",
        "fd12:3456::1",
        "fe80::1%en0",
        "ff02::1",
        "::ffff:10.0.0.1",
        "64:ff9b::a00:1",
        "2002:a00:1::",
        "not-an-ip",
    ],
)
def test_non_public_addresses_are_detected(address: str) -> None:
    assert not is_public_address(address)


@pytest.mark.parametrize("address", [PUBLIC_IP, "1.1.1.1", "2606:4700:4700::1111"])
def test_public_addresses_are_allowed(address: str) -> None:
    assert is_public_address(address)


class TestNetworkBackend:
    async def test_domain_resolving_to_a_private_ip_is_rejected_before_connecting(self) -> None:
        inner = RecordingBackend()
        backend = GuardedNetworkBackend(resolver({"evil.example": ["10.0.0.8"]}), inner)

        with pytest.raises(EndpointNotAllowedError, match="non-public"):
            await backend.connect_tcp("evil.example", 443)

        assert inner.connections == []

    async def test_any_private_answer_rejects_the_host(self) -> None:
        inner = RecordingBackend()
        backend = GuardedNetworkBackend(
            resolver({"mixed.example": [PUBLIC_IP, "127.0.0.1"]}), inner
        )

        with pytest.raises(EndpointNotAllowedError):
            await backend.connect_tcp("mixed.example", 443)

        assert inner.connections == []

    async def test_connects_to_the_exact_address_it_checked(self) -> None:
        inner = RecordingBackend()
        backend = GuardedNetworkBackend(resolver({"llm.example": [PUBLIC_IP]}), inner)

        await backend.connect_tcp("llm.example", 443)

        assert inner.connections == [(PUBLIC_IP, 443)]

    async def test_rejects_a_socket_whose_peer_is_not_public(self) -> None:
        inner = RecordingBackend(peer="10.0.0.8")
        backend = GuardedNetworkBackend(resolver({"rebind.example": [PUBLIC_IP]}), inner)

        with pytest.raises(EndpointNotAllowedError, match="connected address"):
            await backend.connect_tcp("rebind.example", 443)

        assert inner.streams[0].closed

    async def test_unix_sockets_are_never_allowed(self) -> None:
        with pytest.raises(EndpointNotAllowedError):
            await GuardedNetworkBackend(inner=RecordingBackend()).connect_unix_socket(
                "/run/criteria.sock"
            )


class TestTransport:
    async def test_redirects_are_rejected_and_not_followed(self) -> None:
        calls: list[str] = []

        def handler(request: httpx2.Request) -> httpx2.Response:
            calls.append(str(request.url))
            return httpx2.Response(302, headers={"location": "https://169.254.169.254/"})

        transport = GuardedTransport(httpx2.MockTransport(handler), max_response_bytes=1024)
        async with httpx2.AsyncClient(transport=transport, follow_redirects=True) as client:
            with pytest.raises(EndpointNotAllowedError, match="redirect"):
                await client.post("https://llm.example.com/v1/chat/completions", json={})

        assert calls == ["https://llm.example.com/v1/chat/completions"]

    async def test_plain_http_is_rejected_before_any_request(self) -> None:
        calls: list[str] = []

        def handler(request: httpx2.Request) -> httpx2.Response:
            calls.append(str(request.url))
            return httpx2.Response(200)

        transport = GuardedTransport(httpx2.MockTransport(handler), max_response_bytes=1024)
        async with httpx2.AsyncClient(transport=transport) as client:
            with pytest.raises(EndpointNotAllowedError, match="https"):
                await client.post("http://llm.example.com/v1", content=b"secret prompt")

        assert calls == []

    async def test_declared_oversized_responses_are_rejected(self) -> None:
        transport = GuardedTransport(
            httpx2.MockTransport(lambda _: httpx2.Response(200, content=b"x" * 2048)),
            max_response_bytes=1024,
        )
        async with httpx2.AsyncClient(transport=transport) as client:
            with pytest.raises(ResponseTooLargeError):
                await client.get("https://llm.example.com/v1")

    async def test_streamed_bodies_are_cut_at_the_limit(self) -> None:
        async def chunks() -> Any:
            for _ in range(4):
                yield b"x" * 512

        transport = GuardedTransport(
            httpx2.MockTransport(lambda _: httpx2.Response(200, content=chunks())),
            max_response_bytes=1024,
        )
        async with httpx2.AsyncClient(transport=transport) as client:
            with pytest.raises(ResponseTooLargeError):
                await client.get("https://llm.example.com/v1")

    async def test_small_responses_pass_through(self) -> None:
        transport = GuardedTransport(
            httpx2.MockTransport(lambda _: httpx2.Response(200, json={"ok": True})),
            max_response_bytes=1024,
        )
        async with httpx2.AsyncClient(transport=transport) as client:
            response = await client.get("https://llm.example.com/v1")

        assert response.json() == {"ok": True}


class TestRealClient:
    """Uses the production client stack; every target is rejected before a socket opens."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://127.0.0.1:9/v1",
            "https://[::1]:9/v1",
            "https://169.254.169.254/latest",
            "https://[::ffff:127.0.0.1]:9/v1",
            "https://localhost:9/v1",
        ],
    )
    async def test_rejects_local_and_metadata_targets(self, url: str) -> None:
        async with guarded_client(timeout_seconds=2, max_response_bytes=1024) as client:
            with pytest.raises(EndpointNotAllowedError):
                await client.post(url, json={"messages": []})

    async def test_routes_connections_through_the_guarded_backend(self) -> None:
        inner = RecordingBackend()
        backend = GuardedNetworkBackend(resolver({"evil.example": ["10.0.0.8"]}), inner)

        async with guarded_client(
            timeout_seconds=2, max_response_bytes=1024, backend=backend
        ) as client:
            with pytest.raises(EndpointNotAllowedError):
                await client.post("https://evil.example/v1", json={})

        assert inner.connections == []
