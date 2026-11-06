"""One retry for transient provider failures, applied below the SDKs.

The SDKs run with max_retries=0: their own retry also repeats 429s and timeouts, which turned one
slow call into three in F2b. Here only connection failures and 5xx answers get a second attempt.
"""

import httpx
import httpx2

RETRYABLE_STATUS = frozenset({500, 502, 503, 504})


def _is_retryable_status(status_code: int) -> bool:
    return status_code in RETRYABLE_STATUS


class TransientRetryTransport(httpx2.AsyncBaseTransport):
    def __init__(self, inner: httpx2.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        try:
            response = await self._inner.handle_async_request(request)
        except httpx2.ConnectError:
            return await self._inner.handle_async_request(request)
        if not _is_retryable_status(response.status_code):
            return response
        await response.aclose()
        return await self._inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self._inner.aclose()


class LegacyTransientRetryTransport(httpx.AsyncBaseTransport):
    """The same policy for the Groq SDK, which still uses httpx."""

    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        try:
            response = await self._inner.handle_async_request(request)
        except httpx.ConnectError:
            return await self._inner.handle_async_request(request)
        if not _is_retryable_status(response.status_code):
            return response
        await response.aclose()
        return await self._inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self._inner.aclose()


def provider_client(timeout_seconds: float) -> httpx2.AsyncClient:
    return httpx2.AsyncClient(
        transport=TransientRetryTransport(httpx2.AsyncHTTPTransport()),
        timeout=httpx2.Timeout(timeout_seconds),
        follow_redirects=False,
    )


def legacy_provider_client(timeout_seconds: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=LegacyTransientRetryTransport(httpx.AsyncHTTPTransport()),
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=False,
    )
